/**
 * Server-side CRUD for clients.
 * - Verifies active membership of the company.
 * - Requires owner/admin/manager role (via can_manage_company) for writes.
 * - Audits create/update/delete.
 * - Refuses deletion when the client is referenced by a signed PV.
 * - Reads stay on the browser via RLS (clients_select policy).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { writeAuditLog } from "./audit.server";

const ClientPayloadSchema = z.object({
  name: z.string().trim().min(1, "Nom requis").max(200),
  email: z.string().trim().max(255).optional().default(""),
  phone: z.string().trim().max(50).optional().default(""),
  address: z.string().trim().max(500).optional().default(""),
  notes: z.string().trim().max(2000).optional().default(""),
});

const CreateInput = z.object({
  companyId: z.string().uuid(),
  data: ClientPayloadSchema,
});

const UpdateInput = z.object({
  companyId: z.string().uuid(),
  id: z.string().uuid(),
  data: ClientPayloadSchema,
});

const DeleteInput = z.object({
  companyId: z.string().uuid(),
  id: z.string().uuid(),
});

async function assertCanManage(
  supabase: { rpc: (fn: "can_manage_company", args: { _company_id: string; _user_id: string }) => Promise<{ data: unknown; error: unknown }> },
  companyId: string,
  userId: string,
) {
  const { data, error } = await supabase.rpc("can_manage_company", {
    _company_id: companyId,
    _user_id: userId,
  });
  if (error) throw new Error("Vérification des droits impossible.");
  if (data !== true) throw new Error("Droits insuffisants.");
}

function normalize(d: z.infer<typeof ClientPayloadSchema>) {
  return {
    name: d.name.trim(),
    email: d.email.trim() || null,
    phone: d.phone.trim() || null,
    address: d.address.trim() || null,
    notes: d.notes.trim() || null,
  };
}

export const createClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => CreateInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCanManage(supabase, data.companyId, userId);
    const payload = normalize(data.data);
    const { data: row, error } = await supabase
      .from("clients")
      .insert({ ...payload, owner_id: userId, company_id: data.companyId })
      .select("id")
      .single();
    if (error || !row) throw new Error(error?.message ?? "Création impossible.");
    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "client",
      entityId: row.id,
      action: "client.create",
      newValues: payload,
    });
    return { ok: true, id: row.id as string };
  });

export const updateClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => UpdateInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCanManage(supabase, data.companyId, userId);
    const payload = normalize(data.data);
    const { data: prev } = await supabase
      .from("clients")
      .select("name,email,phone,address,notes,company_id")
      .eq("id", data.id)
      .maybeSingle();
    if (!prev || prev.company_id !== data.companyId) throw new Error("Client introuvable.");
    const { error } = await supabase
      .from("clients")
      .update(payload)
      .eq("id", data.id)
      .eq("company_id", data.companyId);
    if (error) throw new Error(error.message);
    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "client",
      entityId: data.id,
      action: "client.update",
      oldValues: prev as Record<string, unknown>,
      newValues: payload,
    });
    return { ok: true };
  });

export const deleteClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => DeleteInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCanManage(supabase, data.companyId, userId);
    // Refuse if any signed PV references this client.
    const { count, error: cErr } = await supabase
      .from("pv")
      .select("id", { count: "exact", head: true })
      .eq("company_id", data.companyId)
      .eq("client_id", data.id)
      .eq("status", "signe");
    if (cErr) throw new Error(cErr.message);
    if ((count ?? 0) > 0) {
      await writeAuditLog({
        companyId: data.companyId,
        userId,
        entityType: "client",
        entityId: data.id,
        action: "client.delete_blocked_signed_pv",
        metadata: { signed_pv_count: count ?? 0 },
      });
      throw new Error("Suppression impossible : ce client est lié à au moins un PV signé.");
    }
    const { data: prev } = await supabase
      .from("clients")
      .select("name,email,phone,address,notes,company_id")
      .eq("id", data.id)
      .maybeSingle();
    if (!prev || prev.company_id !== data.companyId) throw new Error("Client introuvable.");
    const { error } = await supabase
      .from("clients")
      .delete()
      .eq("id", data.id)
      .eq("company_id", data.companyId);
    if (error) throw new Error(error.message);
    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "client",
      entityId: data.id,
      action: "client.delete",
      oldValues: prev as Record<string, unknown>,
    });
    return { ok: true };
  });

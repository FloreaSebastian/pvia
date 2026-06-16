/**
 * Server-side CRUD for chantiers.
 * - Verifies active membership of the company.
 * - Requires owner/admin/manager role (can_manage_company) for writes.
 * - Audits create/update/delete.
 * - Refuses deletion when the chantier is referenced by a signed PV.
 * - Reads remain on the browser via RLS (chantiers_select policy).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { writeAuditLog } from "./audit.server";

const ChantierPayloadSchema = z.object({
  name: z.string().trim().min(1, "Nom requis").max(200),
  address: z.string().trim().max(500).optional().default(""),
  type: z.string().trim().max(100).optional().default(""),
  status: z.enum(["en_cours", "termine", "receptionne"]).default("en_cours"),
  client_id: z.string().uuid().nullable().optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  description: z.string().trim().max(5000).optional().default(""),
});

const CreateInput = z.object({
  companyId: z.string().uuid(),
  data: ChantierPayloadSchema,
});
const UpdateInput = z.object({
  companyId: z.string().uuid(),
  id: z.string().uuid(),
  data: ChantierPayloadSchema,
});
const DeleteInput = z.object({
  companyId: z.string().uuid(),
  id: z.string().uuid(),
});

async function assertCanManage(
  supabase: SupabaseClient<Database>,
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

function normalize(d: z.infer<typeof ChantierPayloadSchema>) {
  return {
    name: d.name.trim(),
    address: d.address.trim() || null,
    type: d.type.trim() || null,
    status: d.status,
    client_id: d.client_id ?? null,
    start_date: d.start_date ?? null,
    end_date: d.end_date ?? null,
    description: d.description.trim() || null,
  };
}

export const createChantier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => CreateInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCanManage(supabase, data.companyId, userId);
    const payload = normalize(data.data);
    const { data: row, error } = await supabase
      .from("chantiers")
      .insert({ ...payload, owner_id: userId, company_id: data.companyId })
      .select("id")
      .single();
    if (error || !row) throw new Error(error?.message ?? "Création impossible.");
    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "chantier",
      entityId: row.id,
      action: "chantier.create",
      newValues: payload,
    });
    return { ok: true, id: row.id as string };
  });

export const updateChantier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => UpdateInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCanManage(supabase, data.companyId, userId);
    const payload = normalize(data.data);
    const { data: prev } = await supabase
      .from("chantiers")
      .select("name,address,type,status,client_id,start_date,end_date,description,company_id")
      .eq("id", data.id)
      .maybeSingle();
    if (!prev || prev.company_id !== data.companyId) throw new Error("Chantier introuvable.");
    const { error } = await supabase
      .from("chantiers")
      .update(payload)
      .eq("id", data.id)
      .eq("company_id", data.companyId);
    if (error) throw new Error(error.message);
    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "chantier",
      entityId: data.id,
      action: "chantier.update",
      oldValues: prev as Record<string, unknown>,
      newValues: payload,
    });
    return { ok: true };
  });

export const deleteChantier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => DeleteInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCanManage(supabase, data.companyId, userId);
    const { count, error: cErr } = await supabase
      .from("pv")
      .select("id", { count: "exact", head: true })
      .eq("company_id", data.companyId)
      .eq("chantier_id", data.id)
      .eq("status", "signe");
    if (cErr) throw new Error(cErr.message);
    if ((count ?? 0) > 0) {
      await writeAuditLog({
        companyId: data.companyId,
        userId,
        entityType: "chantier",
        entityId: data.id,
        action: "chantier.delete_blocked_signed_pv",
        metadata: { signed_pv_count: count ?? 0 },
      });
      throw new Error("Suppression impossible : ce chantier est lié à au moins un PV signé.");
    }
    const { data: prev } = await supabase
      .from("chantiers")
      .select("name,address,type,status,client_id,start_date,end_date,description,company_id")
      .eq("id", data.id)
      .maybeSingle();
    if (!prev || prev.company_id !== data.companyId) throw new Error("Chantier introuvable.");
    const { error } = await supabase
      .from("chantiers")
      .delete()
      .eq("id", data.id)
      .eq("company_id", data.companyId);
    if (error) throw new Error(error.message);
    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "chantier",
      entityId: data.id,
      action: "chantier.delete",
      oldValues: prev as Record<string, unknown>,
    });
    return { ok: true };
  });

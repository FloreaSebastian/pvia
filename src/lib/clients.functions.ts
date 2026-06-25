/**
 * Server-side CRUD for clients.
 * - Verifies active membership of the company.
 * - Requires owner/admin/manager role (via can_manage_company) for writes.
 * - Audits create/update/delete (+ address_updated when address fields change).
 * - Refuses deletion when the client is referenced by a signed PV.
 * - Reads stay on the browser via RLS (clients_select policy).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { writeAuditLog } from "./audit.server";

const ClientPayloadSchema = z.object({
  client_type: z.enum(["particulier", "entreprise"]).default("particulier"),
  name: z.string().trim().min(1, "Nom requis").max(200),
  email: z.string().trim().max(255).optional().default(""),
  phone: z.string().trim().max(50).optional().default(""),
  address: z.string().trim().max(500).optional().default(""),
  address_line1: z.string().trim().max(300).optional().default(""),
  postal_code: z.string().trim().max(20).optional().default(""),
  city: z.string().trim().max(150).optional().default(""),
  latitude: z.number().finite().nullable().optional(),
  longitude: z.number().finite().nullable().optional(),
  notes: z.string().trim().max(2000).optional().default(""),
  // Entreprise-only fields (all optional, validated only when entreprise)
  company_name: z.string().trim().max(200).optional().default(""),
  siret: z.string().trim().max(20).optional().default(""),
  siren: z.string().trim().max(20).optional().default(""),
  vat_number: z.string().trim().max(40).optional().default(""),
  naf_code: z.string().trim().max(20).optional().default(""),
  contact_name: z.string().trim().max(200).optional().default(""),
}).superRefine((d, ctx) => {
  if (d.client_type === "entreprise") {
    const siret = (d.siret ?? "").replace(/\s+/g, "");
    const siren = (d.siren ?? "").replace(/\s+/g, "");
    if (siret && !/^\d{14}$/.test(siret)) ctx.addIssue({ code: "custom", path: ["siret"], message: "SIRET : 14 chiffres" });
    if (siren && !/^\d{9}$/.test(siren)) ctx.addIssue({ code: "custom", path: ["siren"], message: "SIREN : 9 chiffres" });
  }
  if (d.email) {
    const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email);
    if (!ok) ctx.addIssue({ code: "custom", path: ["email"], message: "Email invalide" });
  }
});

const CreateInput = z.object({ companyId: z.string().uuid(), data: ClientPayloadSchema });
const UpdateInput = z.object({ companyId: z.string().uuid(), id: z.string().uuid(), data: ClientPayloadSchema });
const DeleteInput = z.object({ companyId: z.string().uuid(), id: z.string().uuid() });


async function assertCanManage(
  supabase: import("@supabase/supabase-js").SupabaseClient<import("@/integrations/supabase/types").Database>,
  companyId: string,
  userId: string,
) {
  const { data, error } = await supabase.rpc("can_manage_company", { _company_id: companyId, _user_id: userId });
  if (error) throw new Error("Vérification des droits impossible.");
  if (data !== true) throw new Error("Droits insuffisants.");
}

function recompose(line1: string, postal: string, city: string, fallback: string) {
  const parts: string[] = [];
  if (line1.trim()) parts.push(line1.trim());
  const cp = [postal.trim(), city.trim()].filter(Boolean).join(" ");
  if (cp) parts.push(cp);
  const joined = parts.join(", ");
  return joined || fallback.trim();
}

function normalize(d: z.infer<typeof ClientPayloadSchema>) {
  const line1 = (d.address_line1 ?? "").trim();
  const postal = (d.postal_code ?? "").trim();
  const city = (d.city ?? "").trim();
  const composed = recompose(line1, postal, city, d.address ?? "");
  const isEntreprise = d.client_type === "entreprise";
  const companyName = (d.company_name ?? "").trim();
  // For entreprise: ensure `name` mirrors the company name when blank/short, so
  // existing FK consumers still get a meaningful label.
  const finalName = isEntreprise && companyName ? companyName : d.name.trim();
  return {
    client_type: d.client_type,
    name: finalName,
    email: d.email.trim() || null,
    phone: d.phone.trim() || null,
    address: composed || null,
    address_line1: line1 || null,
    postal_code: postal || null,
    city: city || null,
    latitude: typeof d.latitude === "number" ? d.latitude : null,
    longitude: typeof d.longitude === "number" ? d.longitude : null,
    notes: d.notes.trim() || null,
    company_name: isEntreprise ? (companyName || null) : null,
    siret: isEntreprise ? ((d.siret ?? "").replace(/\s+/g, "") || null) : null,
    siren: isEntreprise ? ((d.siren ?? "").replace(/\s+/g, "") || null) : null,
    vat_number: isEntreprise ? ((d.vat_number ?? "").trim() || null) : null,
    naf_code: isEntreprise ? ((d.naf_code ?? "").trim() || null) : null,
    contact_name: isEntreprise ? ((d.contact_name ?? "").trim() || null) : null,
  };
}


const ADDR_FIELDS = ["address", "address_line1", "postal_code", "city", "latitude", "longitude"] as const;
function addressChanged(prev: Record<string, unknown>, next: Record<string, unknown>) {
  return ADDR_FIELDS.some((k) => (prev[k] ?? null) !== (next[k] ?? null));
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
      companyId: data.companyId, userId, entityType: "client", entityId: row.id,
      action: "client.create", newValues: payload,
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
      .select("name,email,phone,address,address_line1,postal_code,city,latitude,longitude,notes,company_id")
      .eq("id", data.id).maybeSingle();
    if (!prev || prev.company_id !== data.companyId) throw new Error("Client introuvable.");
    const { error } = await supabase
      .from("clients").update(payload).eq("id", data.id).eq("company_id", data.companyId);
    if (error) throw new Error(error.message);
    await writeAuditLog({
      companyId: data.companyId, userId, entityType: "client", entityId: data.id,
      action: "client.update", oldValues: prev as Record<string, unknown>, newValues: payload,
    });
    if (addressChanged(prev as Record<string, unknown>, payload)) {
      await writeAuditLog({
        companyId: data.companyId, userId, entityType: "client", entityId: data.id,
        action: "client.address_updated",
        oldValues: Object.fromEntries(ADDR_FIELDS.map((k) => [k, (prev as Record<string, unknown>)[k] ?? null])),
        newValues: Object.fromEntries(ADDR_FIELDS.map((k) => [k, (payload as Record<string, unknown>)[k] ?? null])),
      });
    }
    return { ok: true };
  });

export const deleteClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => DeleteInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCanManage(supabase, data.companyId, userId);
    const { count, error: cErr } = await supabase
      .from("pv").select("id", { count: "exact", head: true })
      .eq("company_id", data.companyId).eq("client_id", data.id).eq("status", "signe");
    if (cErr) throw new Error(cErr.message);
    if ((count ?? 0) > 0) {
      await writeAuditLog({
        companyId: data.companyId, userId, entityType: "client", entityId: data.id,
        action: "client.delete_blocked_signed_pv", metadata: { signed_pv_count: count ?? 0 },
      });
      throw new Error("Suppression impossible : ce client est lié à au moins un PV signé.");
    }
    const { data: prev } = await supabase
      .from("clients").select("name,email,phone,address,company_id").eq("id", data.id).maybeSingle();
    if (!prev || prev.company_id !== data.companyId) throw new Error("Client introuvable.");
    const { error } = await supabase.from("clients").delete().eq("id", data.id).eq("company_id", data.companyId);
    if (error) throw new Error(error.message);
    await writeAuditLog({
      companyId: data.companyId, userId, entityType: "client", entityId: data.id,
      action: "client.delete", oldValues: prev as Record<string, unknown>,
    });
    return { ok: true };
  });

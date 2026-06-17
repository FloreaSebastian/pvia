/**
 * Server-side CRUD for chantiers.
 * - Verifies active membership of the company.
 * - Requires owner/admin/manager role (can_manage_company) for writes.
 * - Audits create/update/delete (+ address_updated when address fields change).
 * - Refuses deletion when the chantier is referenced by a signed PV.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { writeAuditLog } from "./audit.server";

export const CHANTIER_STATUSES = [
  "preparation", "planifie", "en_cours", "en_attente", "receptionne", "termine", "archive",
] as const;
export type ChantierStatus = (typeof CHANTIER_STATUSES)[number];

const ChantierPayloadSchema = z.object({
  name: z.string().trim().min(1, "Nom requis").max(200),
  address: z.string().trim().max(500).optional().default(""),
  address_line1: z.string().trim().max(300).optional().default(""),
  postal_code: z.string().trim().max(20).optional().default(""),
  city: z.string().trim().max(150).optional().default(""),
  latitude: z.number().finite().nullable().optional(),
  longitude: z.number().finite().nullable().optional(),
  type: z.string().trim().max(100).optional().default(""),
  status: z.enum(CHANTIER_STATUSES).default("planifie"),
  client_id: z.string().uuid().nullable().optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  description: z.string().trim().max(5000).optional().default(""),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  progress_percent: z.number().int().min(0).max(100).optional().default(0),
});

const CreateInput = z.object({ companyId: z.string().uuid(), data: ChantierPayloadSchema });
const UpdateInput = z.object({ companyId: z.string().uuid(), id: z.string().uuid(), data: ChantierPayloadSchema });
const DeleteInput = z.object({ companyId: z.string().uuid(), id: z.string().uuid() });

async function assertCanManage(supabase: SupabaseClient<Database>, companyId: string, userId: string) {
  const { data, error } = await supabase.rpc("can_manage_company", { _company_id: companyId, _user_id: userId });
  if (error) throw new Error("Vérification des droits impossible.");
  if (data !== true) throw new Error("Droits insuffisants.");
}

function recompose(line1: string, postal: string, city: string, fallback: string) {
  const parts: string[] = [];
  if (line1.trim()) parts.push(line1.trim());
  const cp = [postal.trim(), city.trim()].filter(Boolean).join(" ");
  if (cp) parts.push(cp);
  return parts.join(", ") || fallback.trim();
}

function normalize(d: z.infer<typeof ChantierPayloadSchema>) {
  const line1 = (d.address_line1 ?? "").trim();
  const postal = (d.postal_code ?? "").trim();
  const city = (d.city ?? "").trim();
  const composed = recompose(line1, postal, city, d.address ?? "");
  return {
    name: d.name.trim(),
    address: composed || null,
    address_line1: line1 || null,
    postal_code: postal || null,
    city: city || null,
    latitude: typeof d.latitude === "number" ? d.latitude : null,
    longitude: typeof d.longitude === "number" ? d.longitude : null,
    type: d.type.trim() || null,
    status: d.status,
    client_id: d.client_id ?? null,
    start_date: d.start_date ?? null,
    end_date: d.end_date ?? null,
    description: d.description.trim() || null,
    color: d.color ? d.color.toLowerCase() : null,
    progress_percent: typeof d.progress_percent === "number" ? d.progress_percent : 0,
  };
}

const ADDR_FIELDS = ["address", "address_line1", "postal_code", "city", "latitude", "longitude"] as const;
function addressChanged(prev: Record<string, unknown>, next: Record<string, unknown>) {
  return ADDR_FIELDS.some((k) => (prev[k] ?? null) !== (next[k] ?? null));
}

export const createChantier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => CreateInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCanManage(supabase, data.companyId, userId);
    const payload = normalize(data.data);
    const { data: row, error } = await supabase
      .from("chantiers").insert({ ...payload, owner_id: userId, company_id: data.companyId })
      .select("id").single();
    if (error || !row) throw new Error(error?.message ?? "Création impossible.");
    await writeAuditLog({
      companyId: data.companyId, userId, entityType: "chantier", entityId: row.id,
      action: "chantier.create", newValues: payload,
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
      .select("name,address,address_line1,postal_code,city,latitude,longitude,type,status,client_id,start_date,end_date,description,company_id")
      .eq("id", data.id).maybeSingle();
    if (!prev || prev.company_id !== data.companyId) throw new Error("Chantier introuvable.");
    const { error } = await supabase.from("chantiers").update(payload).eq("id", data.id).eq("company_id", data.companyId);
    if (error) throw new Error(error.message);
    await writeAuditLog({
      companyId: data.companyId, userId, entityType: "chantier", entityId: data.id,
      action: "chantier.update", oldValues: prev as Record<string, unknown>, newValues: payload,
    });
    if (addressChanged(prev as Record<string, unknown>, payload)) {
      await writeAuditLog({
        companyId: data.companyId, userId, entityType: "chantier", entityId: data.id,
        action: "chantier.address_updated",
        oldValues: Object.fromEntries(ADDR_FIELDS.map((k) => [k, (prev as Record<string, unknown>)[k] ?? null])),
        newValues: Object.fromEntries(ADDR_FIELDS.map((k) => [k, (payload as Record<string, unknown>)[k] ?? null])),
      });
    }
    return { ok: true };
  });

export const deleteChantier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => DeleteInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCanManage(supabase, data.companyId, userId);
    const { count, error: cErr } = await supabase
      .from("pv").select("id", { count: "exact", head: true })
      .eq("company_id", data.companyId).eq("chantier_id", data.id).eq("status", "signe");
    if (cErr) throw new Error(cErr.message);
    if ((count ?? 0) > 0) {
      await writeAuditLog({
        companyId: data.companyId, userId, entityType: "chantier", entityId: data.id,
        action: "chantier.delete_blocked_signed_pv", metadata: { signed_pv_count: count ?? 0 },
      });
      throw new Error("Suppression impossible : ce chantier est lié à au moins un PV signé.");
    }
    const { data: prev } = await supabase
      .from("chantiers").select("name,address,company_id").eq("id", data.id).maybeSingle();
    if (!prev || prev.company_id !== data.companyId) throw new Error("Chantier introuvable.");
    const { error } = await supabase.from("chantiers").delete().eq("id", data.id).eq("company_id", data.companyId);
    if (error) throw new Error(error.message);
    await writeAuditLog({
      companyId: data.companyId, userId, entityType: "chantier", entityId: data.id,
      action: "chantier.delete", oldValues: prev as Record<string, unknown>,
    });
    return { ok: true };
  });

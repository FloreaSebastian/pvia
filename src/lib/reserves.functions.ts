/**
 * Server functions for pv_reserves write operations.
 * - updateReserveStatus: requires can_manage_company (owner/admin/manager)
 * - deleteReserve:       requires is_company_admin (owner/admin); refused if PV signé/verrouillé
 *
 * Audit actions:
 * - reserve.status_updated
 * - reserve.delete
 * - reserve.delete_blocked_signed_pv
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { writeAuditLog } from "./audit.server";

async function assertActiveMember(sb: SupabaseClient<Database>, companyId: string, userId: string) {
  const { data, error } = await sb.rpc("is_company_member", { _company_id: companyId, _user_id: userId });
  if (error) throw new Error("Vérification des droits impossible.");
  if (data !== true) throw new Error("Accès refusé.");
}
async function assertCanManage(sb: SupabaseClient<Database>, companyId: string, userId: string) {
  const { data, error } = await sb.rpc("can_manage_company", { _company_id: companyId, _user_id: userId });
  if (error) throw new Error("Vérification des droits impossible.");
  if (data !== true) throw new Error("Droits insuffisants (manager requis).");
}
async function assertIsAdmin(sb: SupabaseClient<Database>, companyId: string, userId: string) {
  const { data, error } = await sb.rpc("is_company_admin", { _company_id: companyId, _user_id: userId });
  if (error) throw new Error("Vérification des droits impossible.");
  if (data !== true) throw new Error("Droits insuffisants (admin requis).");
}

const ReserveStatus = z.enum(["ouverte", "levee", "validee"]);

export const updateReserveStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({
    companyId: z.string().uuid(),
    id: z.string().uuid(),
    status: ReserveStatus,
  }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertActiveMember(supabase, data.companyId, userId);
    await assertCanManage(supabase, data.companyId, userId);

    const { data: prev, error: readErr } = await supabase
      .from("pv_reserves")
      .select("id,pv_id,status,company_id")
      .eq("id", data.id)
      .eq("company_id", data.companyId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!prev) throw new Error("Réserve introuvable.");

    const { error } = await supabase
      .from("pv_reserves")
      .update({ status: data.status })
      .eq("id", data.id)
      .eq("company_id", data.companyId);
    if (error) throw new Error(error.message);

    await writeAuditLog({
      companyId: data.companyId, userId, entityType: "reserve", entityId: data.id,
      action: "reserve.status_updated",
      oldValues: { status: prev.status },
      newValues: { status: data.status },
      metadata: { pv_id: prev.pv_id },
    });
    return { ok: true };
  });

export const deleteReserve = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({
    companyId: z.string().uuid(),
    id: z.string().uuid(),
  }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertActiveMember(supabase, data.companyId, userId);
    await assertIsAdmin(supabase, data.companyId, userId);

    const { data: prev, error: readErr } = await supabase
      .from("pv_reserves")
      .select("id,pv_id,description,severity,status,company_id")
      .eq("id", data.id)
      .eq("company_id", data.companyId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!prev) throw new Error("Réserve introuvable.");

    const { data: pv } = await supabase
      .from("pv")
      .select("id,status,locked_at,numero")
      .eq("id", prev.pv_id)
      .maybeSingle();

    const isLocked = pv && (pv.status === "signe" || pv.locked_at !== null);
    if (isLocked) {
      await writeAuditLog({
        companyId: data.companyId, userId, entityType: "reserve", entityId: data.id,
        action: "reserve.delete_blocked_signed_pv",
        metadata: { pv_id: prev.pv_id, pv_numero: pv?.numero ?? null, pv_status: pv?.status ?? null },
      });
      throw new Error("Suppression refusée : le PV est signé/verrouillé.");
    }

    const { error } = await supabase
      .from("pv_reserves")
      .delete()
      .eq("id", data.id)
      .eq("company_id", data.companyId);
    if (error) throw new Error(error.message);

    await writeAuditLog({
      companyId: data.companyId, userId, entityType: "reserve", entityId: data.id,
      action: "reserve.delete",
      oldValues: { status: prev.status, severity: prev.severity, description: prev.description },
      metadata: { pv_id: prev.pv_id, pv_numero: pv?.numero ?? null },
    });
    return { ok: true };
  });

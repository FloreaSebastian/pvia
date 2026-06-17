/**
 * Server functions pour pv_reserves.
 *
 * Rôles autorisés par action :
 * - updateReserveStatus :
 *    - technicien : ouverte / en_cours / levee
 *    - conducteur_travaux, responsable_exploitation, directeur : tous statuts
 *    - assistant_admin, lecture_seule : refusé
 * - assignReserve         : conducteur+ (conducteur_travaux, responsable_exploitation, directeur)
 * - bulkUpdateReserves    : conducteur+
 * - exportReservesCsv     : tout membre actif
 * - deleteReserve         : directeur / responsable_exploitation, refusé si PV signé/verrouillé
 *
 * Audit :
 * - reserve.status_updated, reserve.assigned, reserve.bulk_updated,
 *   reserve.exported, reserve.delete, reserve.delete_blocked_signed_pv
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { writeAuditLog } from "./audit.server";

type RoleValue =
  | "directeur"
  | "responsable_exploitation"
  | "conducteur_travaux"
  | "technicien"
  | "assistant_admin"
  | "lecture_seule";

async function getRole(
  sb: SupabaseClient<Database>,
  companyId: string,
  userId: string,
): Promise<RoleValue> {
  const { data, error } = await sb.rpc("get_company_role", {
    _company_id: companyId,
    _user_id: userId,
  });
  if (error) throw new Error("Vérification des droits impossible.");
  if (!data) throw new Error("Accès refusé.");
  return data as RoleValue;
}

const ADMIN_ROLES: RoleValue[] = ["directeur", "responsable_exploitation"];
const MANAGE_ROLES: RoleValue[] = [
  "directeur",
  "responsable_exploitation",
  "conducteur_travaux",
];
const TECH_ALLOWED_STATUS = ["ouverte", "en_cours", "levee"] as const;

const ReserveStatus = z.enum([
  "ouverte",
  "en_cours",
  "levee",
  "en_attente_validation",
  "validee",
  "rejetee",
]);
const Priority = z.enum(["low", "normal", "high"]);

// ---------------------------------------------------------------------------
// updateReserveStatus
// ---------------------------------------------------------------------------
export const updateReserveStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        companyId: z.string().uuid(),
        id: z.string().uuid(),
        status: ReserveStatus,
        reason: z.string().max(2000).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const role = await getRole(supabase, data.companyId, userId);
    if (role === "lecture_seule" || role === "assistant_admin") {
      throw new Error("Droits insuffisants pour modifier le statut.");
    }

    const { data: prev, error: readErr } = await supabase
      .from("pv_reserves")
      .select("id,pv_id,status,company_id,assigned_to")
      .eq("id", data.id)
      .eq("company_id", data.companyId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!prev) throw new Error("Réserve introuvable.");

    if (role === "technicien") {
      if (!TECH_ALLOWED_STATUS.includes(data.status as never)) {
        throw new Error("Un technicien ne peut passer qu'aux statuts Ouverte / En cours / Levée.");
      }
      if (prev.assigned_to !== userId) {
        throw new Error("Cette réserve ne vous est pas assignée.");
      }
    }

    if (data.status === "rejetee" && !data.reason?.trim()) {
      throw new Error("Un motif est requis pour rejeter une réserve.");
    }

    const { error } = await supabase
      .from("pv_reserves")
      .update({ status: data.status })
      .eq("id", data.id)
      .eq("company_id", data.companyId);
    if (error) throw new Error(error.message);

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "reserve",
      entityId: data.id,
      action: "reserve.status_updated",
      oldValues: { status: prev.status },
      newValues: { status: data.status },
      metadata: { pv_id: prev.pv_id, role, reason: data.reason ?? null },
    });
    return { ok: true };

  });

// ---------------------------------------------------------------------------
// assignReserve
// ---------------------------------------------------------------------------
export const assignReserve = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        companyId: z.string().uuid(),
        id: z.string().uuid(),
        assignedTo: z.string().uuid().nullable(),
        dueDate: z.string().nullable().optional(),
        priority: Priority.optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const role = await getRole(supabase, data.companyId, userId);
    if (!MANAGE_ROLES.includes(role)) {
      throw new Error("Droits insuffisants (conducteur requis).");
    }

    const patch: Database["public"]["Tables"]["pv_reserves"]["Update"] = {
      assigned_to: data.assignedTo,
    };
    if (data.dueDate !== undefined) patch.due_date = data.dueDate;
    if (data.priority) patch.priority = data.priority;

    const { error } = await supabase
      .from("pv_reserves")
      .update(patch)

      .eq("id", data.id)
      .eq("company_id", data.companyId);
    if (error) throw new Error(error.message);

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "reserve",
      entityId: data.id,
      action: "reserve.assigned",
      newValues: patch,
      metadata: { role },
    });

    // Email "réserve assignée" (best-effort, never blocks the response)
    if (data.assignedTo) {
      try {
        const { sendReserveAssignedEmail } = await import("./reserve-email.server");
        await sendReserveAssignedEmail(data.id, data.assignedTo);
      } catch (e) {
        console.error("reserve.assigned email failed:", e);
      }
    }
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// bulkUpdateReserves
// ---------------------------------------------------------------------------
export const bulkUpdateReserves = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        companyId: z.string().uuid(),
        ids: z.array(z.string().uuid()).min(1).max(200),
        status: ReserveStatus.optional(),
        assignedTo: z.string().uuid().nullable().optional(),
        dueDate: z.string().nullable().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const role = await getRole(supabase, data.companyId, userId);
    if (!MANAGE_ROLES.includes(role)) {
      throw new Error("Droits insuffisants (conducteur requis).");
    }

    const patch: Database["public"]["Tables"]["pv_reserves"]["Update"] = {};
    if (data.status) patch.status = data.status;
    if (data.assignedTo !== undefined) patch.assigned_to = data.assignedTo;
    if (data.dueDate !== undefined) patch.due_date = data.dueDate;
    if (Object.keys(patch).length === 0) throw new Error("Aucun changement.");

    const { error } = await supabase
      .from("pv_reserves")
      .update(patch)

      .in("id", data.ids)
      .eq("company_id", data.companyId);
    if (error) throw new Error(error.message);

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "reserve",
      action: "reserve.bulk_updated",
      newValues: patch,
      metadata: { ids: data.ids, count: data.ids.length, role },
    });
    return { ok: true, count: data.ids.length };
  });

// ---------------------------------------------------------------------------
// exportReservesCsv
// ---------------------------------------------------------------------------
function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v).replace(/"/g, '""');
  return /[",\n;]/.test(s) ? `"${s}"` : s;
}

export const exportReservesCsv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        companyId: z.string().uuid(),
        ids: z.array(z.string().uuid()).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await getRole(supabase, data.companyId, userId);

    let q = supabase
      .from("pv_reserves")
      .select(
        "id,description,severity,status,priority,due_date,assigned_to,created_at,lifted_at,validated_at,pv_id,pv:pv_id(numero,chantier_id,client_id,chantier:chantier_id(nom),client:client_id(nom))",
      )
      .eq("company_id", data.companyId)
      .order("created_at", { ascending: false });
    if (data.ids?.length) q = q.in("id", data.ids);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const header = [
      "PV",
      "Client",
      "Chantier",
      "Description",
      "Gravité",
      "Statut",
      "Priorité",
      "Échéance",
      "Responsable",
      "Date création",
      "Date levée",
      "Date validation",
    ];
    const lines = [header.join(";")];
    for (const r of rows ?? []) {
      const pv = (r as any).pv;
      lines.push(
        [
          csvEscape(pv?.numero),
          csvEscape(pv?.client?.nom),
          csvEscape(pv?.chantier?.nom),
          csvEscape(r.description),
          csvEscape(r.severity),
          csvEscape(r.status),
          csvEscape((r as any).priority),
          csvEscape(r.due_date),
          csvEscape((r as any).assigned_to),
          csvEscape(r.created_at),
          csvEscape(r.lifted_at),
          csvEscape(r.validated_at),
        ].join(";"),
      );
    }

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "reserve",
      action: "reserve.exported",
      metadata: { count: rows?.length ?? 0, filtered: !!data.ids?.length },
    });

    return { csv: lines.join("\n"), count: rows?.length ?? 0 };
  });

// ---------------------------------------------------------------------------
// deleteReserve (inchangé : directeur/responsable uniquement, refus si PV signé)
// ---------------------------------------------------------------------------
export const deleteReserve = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        companyId: z.string().uuid(),
        id: z.string().uuid(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const role = await getRole(supabase, data.companyId, userId);
    if (!ADMIN_ROLES.includes(role)) {
      throw new Error("Droits insuffisants (directeur ou responsable requis).");
    }

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
        companyId: data.companyId,
        userId,
        entityType: "reserve",
        entityId: data.id,
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
      companyId: data.companyId,
      userId,
      entityType: "reserve",
      entityId: data.id,
      action: "reserve.delete",
      oldValues: { status: prev.status, severity: prev.severity, description: prev.description },
      metadata: { pv_id: prev.pv_id, pv_numero: pv?.numero ?? null, role },
    });
    return { ok: true };
  });

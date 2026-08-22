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

/**
 * Machine d'état serveur. Empêche les sauts illégitimes forgés côté client
 * (ex. ouverte → validée sans levée, rejetée → validée).
 * La réouverture d'une réserve validée reste possible pour les rôles admin.
 */
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  ouverte: ["en_cours", "levee", "rejetee"],
  en_cours: ["ouverte", "levee", "rejetee"],
  levee: ["en_attente_validation", "validee", "rejetee", "en_cours"],
  en_attente_validation: ["validee", "rejetee", "en_cours", "levee"],
  validee: [], // terminal (réouverture admin gérée à part)
  rejetee: ["ouverte", "en_cours"],
};

function assertTransition(from: string, to: string, role: RoleValue) {
  if (from === to) return;
  if (from === "validee" && to === "ouverte" && ADMIN_ROLES.includes(role)) return;
  if (!(ALLOWED_TRANSITIONS[from] ?? []).includes(to)) {
    throw new Error("Transition de statut non autorisée pour cette réserve.");
  }
}

/** Vérifie qu'un utilisateur assigné appartient bien à l'entreprise. */
async function assertMemberOfCompany(
  sb: SupabaseClient<Database>,
  companyId: string,
  assignedTo: string,
) {
  const { data } = await sb
    .from("company_members")
    .select("id")
    .eq("company_id", companyId)
    .eq("user_id", assignedTo)
    .eq("status", "active")
    .maybeSingle();
  if (!data) throw new Error("Ce responsable n'appartient pas à l'entreprise.");
}

const ReserveStatus = z.enum([
  "ouverte",
  "en_cours",
  "levee",
  "en_attente_validation",
  "validee",
  "rejetee",
]);
const Priority = z.enum(["low", "normal", "high"]);

/** Ne jamais renvoyer l'erreur Zod brute au navigateur. */
function validate<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw new Error("Données invalides.");
  return r.data;
}


// ---------------------------------------------------------------------------
// updateReserveStatus
// ---------------------------------------------------------------------------
export const updateReserveStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    validate(
      z.object({
        companyId: z.string().uuid(),
        id: z.string().uuid(),
        status: ReserveStatus,
        reason: z.string().max(2000).optional(),
      }), i),
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

    assertTransition(prev.status, data.status, role);

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
    validate(
      z.object({
        companyId: z.string().uuid(),
        id: z.string().uuid(),
        assignedTo: z.string().uuid().nullable(),
        dueDate: z.string().nullable().optional(),
        priority: Priority.optional(),
      }), i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const role = await getRole(supabase, data.companyId, userId);
    if (!MANAGE_ROLES.includes(role)) {
      throw new Error("Droits insuffisants (conducteur requis).");
    }

    if (data.assignedTo) await assertMemberOfCompany(supabase, data.companyId, data.assignedTo);

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
    validate(
      z.object({
        companyId: z.string().uuid(),
        ids: z.array(z.string().uuid()).min(1).max(200),
        status: ReserveStatus.optional(),
        assignedTo: z.string().uuid().nullable().optional(),
        dueDate: z.string().nullable().optional(),
      }), i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const role = await getRole(supabase, data.companyId, userId);
    if (!MANAGE_ROLES.includes(role)) {
      throw new Error("Droits insuffisants (conducteur requis).");
    }

    if (data.assignedTo) await assertMemberOfCompany(supabase, data.companyId, data.assignedTo);

    // Restreindre aux réserves réellement possédées par l'entreprise appelante
    const { data: owned } = await supabase
      .from("pv_reserves")
      .select("id,status")
      .eq("company_id", data.companyId)
      .in("id", data.ids);
    const ownedRows = (owned ?? []) as { id: string; status: string }[];
    if (ownedRows.length === 0) throw new Error("Aucune réserve concernée.");
    if (data.status) {
      for (const r of ownedRows) assertTransition(r.status, data.status, role);
    }
    const ownedIds = ownedRows.map((r) => r.id);

    const patch: Database["public"]["Tables"]["pv_reserves"]["Update"] = {};
    if (data.status) patch.status = data.status;
    if (data.assignedTo !== undefined) patch.assigned_to = data.assignedTo;
    if (data.dueDate !== undefined) patch.due_date = data.dueDate;
    if (Object.keys(patch).length === 0) throw new Error("Aucun changement.");

    const { error } = await supabase
      .from("pv_reserves")
      .update(patch)

      .in("id", ownedIds)
      .eq("company_id", data.companyId);
    if (error) throw new Error(error.message);

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "reserve",
      action: "reserve.bulk_updated",
      newValues: patch,
      metadata: { ids: ownedIds, count: ownedIds.length, role },
    });
    return { ok: true, count: ownedIds.length };
  });

// ---------------------------------------------------------------------------
// exportReservesCsv
// ---------------------------------------------------------------------------
function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  // CSV/Excel formula injection: neutralize leading =,+,-,@,tab,CR
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  s = s.replace(/"/g, '""');
  return /[",\n;]/.test(s) ? `"${s}"` : s;
}


export const exportReservesCsv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    validate(
      z.object({
        companyId: z.string().uuid(),
        ids: z.array(z.string().uuid()).optional(),
      }), i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await getRole(supabase, data.companyId, userId);

    let q = supabase
      .from("pv_reserves")
      .select(
        "id,description,severity,status,priority,due_date,assigned_to,created_at,lifted_at,validated_at,pv_id,pv:pv_id(numero,chantier_id,client_id,chantier:chantier_id(name,reference),client:client_id(name))",
      )

      .eq("company_id", data.companyId)
      .order("created_at", { ascending: false });
    if (data.ids?.length) q = q.in("id", data.ids);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    // Résolution des responsables (assigned_to → profile.full_name)
    const assigneeIds = Array.from(
      new Set(((rows ?? []) as any[]).map((r) => r.assigned_to).filter(Boolean)),
    ) as string[];
    const assigneeMap = new Map<string, string>();
    if (assigneeIds.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id,full_name")
        .in("id", assigneeIds);
      for (const p of (profs ?? []) as any[]) {
        if (p?.id && p?.full_name) assigneeMap.set(p.id, p.full_name);
      }
    }

    const header = [
      "PV",
      "Client",
      "Chantier",
      "Réf. chantier",
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

    const STATUS_FR: Record<string, string> = {
      ouverte: "Ouverte",
      en_cours: "En cours",
      levee: "Levée",
      en_attente_validation: "À valider",
      validee: "Validée",
      rejetee: "Rejetée",
    };
    const PRIORITY_FR: Record<string, string> = { low: "Basse", normal: "Normale", high: "Haute" };
    const SEVERITY_FR: Record<string, string> = { mineure: "Mineure", majeure: "Majeure" };
    const dateFr = (v: string | null | undefined) =>
      v ? new Date(v).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" }) : "";

    for (const r of rows ?? []) {
      const pv = (r as any).pv;
      const assigneeId = (r as any).assigned_to as string | null;
      // Never leak a raw user id into an exported file.
      const assigneeName = assigneeId ? (assigneeMap.get(assigneeId) ?? "Membre") : "";
      lines.push(
        [
          csvEscape(pv?.numero),
          csvEscape(pv?.client?.name),
          csvEscape(pv?.chantier?.name),
          csvEscape(pv?.chantier?.reference),
          csvEscape(r.description),
          csvEscape(SEVERITY_FR[r.severity] ?? r.severity),
          csvEscape(STATUS_FR[r.status] ?? r.status),
          csvEscape(PRIORITY_FR[(r as any).priority] ?? (r as any).priority),
          csvEscape(dateFr(r.due_date)),
          csvEscape(assigneeName),
          csvEscape(dateFr(r.created_at)),
          csvEscape(dateFr(r.lifted_at)),
          csvEscape(dateFr(r.validated_at)),
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
    validate(
      z.object({
        companyId: z.string().uuid(),
        id: z.string().uuid(),
      }), i),
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

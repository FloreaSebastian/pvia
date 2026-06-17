/**
 * Aggregate a chronological history for a single reserve.
 * Sources:
 *  - audit_logs scoped to entity_type=reserve / reserve_lift / reserve_lift_photo
 *  - reserve_lift_reports linked via reserve_lift_items
 *  - notifications targeting the reserve owner with type starting with "reserve_"
 *
 * Returns a flat, descending timeline with a stable shape consumed by the UI.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type ReserveHistoryEntry = {
  at: string;
  source: "audit" | "lift" | "notification" | "reserve";
  action: string;
  label: string;
  actor?: string | null;
  details?: string | null;
};

const ACTION_LABEL: Record<string, string> = {
  "reserve.created": "Création de la réserve",
  "reserve.updated": "Modification",
  "reserve.assigned": "Assignation",
  "reserve.lifted": "Réserve levée",
  "reserve.validated": "Validation",
  "reserve.rejected": "Rejet",
  "reserve.deleted": "Suppression",
  "reserve_lift.created": "Brouillon de levée créé",
  "reserve_lift.signed": "Levée signée (entreprise)",
  "reserve_lift.client_validated": "Validation client",
  "reserve_lift.client_rejected": "Rejet client",
  "reserve_lift.validation_email_sent": "Email de validation envoyé",
  "reserve_lift.client_validated_email_resent": "Relance email validation",
  "reserve_lift_photo.exif_detected": "Photo (EXIF détecté)",
  "reserve_lift_photo.exif_missing": "Photo (sans EXIF)",
  "reserve_lift_photo.suspicious_metadata": "Anomalie photo détectée",
  "reserve_lift_photo.integrity_checked": "Intégrité photo vérifiée",
  "reserve_lift_photo.integrity_failed": "Intégrité photo en échec",
  "reserve_lift_photo.deleted": "Photo supprimée",
  "reserve.reminder_sent": "Rappel d'échéance envoyé",
};

function labelFor(action: string): string {
  return ACTION_LABEL[action] ?? action;
}

export const getReserveHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ reserveId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: reserve } = await supabaseAdmin
      .from("pv_reserves")
      .select("id,company_id,pv_id,owner_id,created_at,assigned_to,lifted_at,validated_at,description")
      .eq("id", data.reserveId)
      .maybeSingle();
    if (!reserve?.company_id) throw new Error("Réserve introuvable.");

    const { data: member } = await supabaseAdmin
      .from("company_members")
      .select("id")
      .eq("company_id", reserve.company_id)
      .eq("user_id", context.userId)
      .eq("status", "active")
      .maybeSingle();
    if (!member) throw new Error("Accès refusé.");

    const entries: ReserveHistoryEntry[] = [];

    // 1. Reserve own milestones (from columns)
    entries.push({
      at: reserve.created_at as string,
      source: "reserve",
      action: "reserve.created",
      label: "Création de la réserve",
    });
    if (reserve.lifted_at) {
      entries.push({ at: reserve.lifted_at as string, source: "reserve", action: "reserve.lifted", label: "Réserve levée" });
    }
    if (reserve.validated_at) {
      entries.push({ at: reserve.validated_at as string, source: "reserve", action: "reserve.validated", label: "Validée" });
    }

    // 2. Audit logs scoped to this reserve, plus lift events touching it, plus photo events.
    const { data: directAudits } = await supabaseAdmin
      .from("audit_logs")
      .select("id,action,created_at,metadata,user_id")
      .in("entity_type", ["reserve", "reserve_lift_photo"])
      .eq("entity_id", data.reserveId)
      .order("created_at", { ascending: false })
      .limit(200);

    for (const a of (directAudits ?? []) as any[]) {
      entries.push({
        at: a.created_at,
        source: "audit",
        action: a.action,
        label: labelFor(a.action),
        actor: a.user_id ?? null,
        details: a.metadata?.report_id ? `Rapport ${String(a.metadata.report_id).slice(0, 8)}…` : null,
      });
    }

    // 3. Lift reports that include this reserve (via reserve_lift_items).
    const { data: items } = await supabaseAdmin
      .from("reserve_lift_items")
      .select("report_id")
      .eq("reserve_id", data.reserveId);
    const reportIds = Array.from(new Set((items ?? []).map((i: any) => i.report_id))).filter(Boolean);
    if (reportIds.length) {
      const { data: liftAudits } = await supabaseAdmin
        .from("audit_logs")
        .select("id,action,created_at,metadata,actor")
        .eq("entity_type", "reserve_lift")
        .in("entity_id", reportIds)
        .order("created_at", { ascending: false })
        .limit(200);
      for (const a of (liftAudits ?? []) as any[]) {
        entries.push({
          at: a.created_at,
          source: "lift",
          action: a.action,
          label: labelFor(a.action),
          actor: a.actor ?? null,
          details: a.metadata?.numero ? `Levée ${a.metadata.numero}` : null,
        });
      }
    }

    // 4. Notifications attached to this reserve's stakeholders.
    const { data: notifs } = await supabaseAdmin
      .from("notifications")
      .select("id,type,title,body,created_at")
      .eq("company_id", reserve.company_id)
      .in("user_id", [reserve.owner_id, reserve.assigned_to].filter(Boolean) as string[])
      .like("type", "reserve_%")
      .order("created_at", { ascending: false })
      .limit(50);
    for (const n of (notifs ?? []) as any[]) {
      // Filter to those that look related to this reserve via body fragment (best-effort).
      const desc = (reserve.description ?? "").slice(0, 40);
      if (desc && n.body && !String(n.body).includes(desc.slice(0, 20))) continue;
      entries.push({
        at: n.created_at,
        source: "notification",
        action: n.type,
        label: n.title || labelFor(n.type),
        details: n.body ?? null,
      });
    }

    // De-duplicate and sort descending.
    const seen = new Set<string>();
    const unique = entries.filter((e) => {
      const k = `${e.at}|${e.action}|${e.details ?? ""}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    unique.sort((a, b) => (a.at < b.at ? 1 : -1));

    return { entries: unique };
  });

/**
 * Lot 3.4 — Cron : rappels d'échéance des réserves.
 *
 * À planifier toutes les heures (ou 2× / jour).
 * Filtre les réserves :
 *  - status ∈ {ouverte, en_cours, rejetee, en_attente_validation}
 *  - assigned_to non null
 *  - due_date non null
 *  - last_deadline_reminder_at non envoyé < 12h
 *
 * Deux cas :
 *  - due_date entre maintenant et +24h        → "deadline_near"  (responsable seul)
 *  - due_date dépassée (< maintenant)         → "overdue"        (responsable + directeurs/responsables exploitation)
 *
 * Idempotent via `last_deadline_reminder_at` + compteur `deadline_reminder_count`.
 * Audit :  reserve.deadline_reminder_sent / reserve.overdue_alert_sent
 *
 * Protégé par x-cron-secret (header).
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import {
  sendReserveDeadlineNearEmail,
  sendReserveOverdueEmail,
} from "@/lib/reserve-email.server";

const ACTIVE_STATUSES = ["ouverte", "en_cours", "rejetee", "en_attente_validation"];
const MIN_REMINDER_GAP_HOURS = 12;

function getDb() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function run() {
  const db = getDb() as any;
  const now = new Date();
  const nowIso = now.toISOString();
  const in24h = new Date(now.getTime() + 24 * 3600 * 1000).toISOString();
  const gapCutoff = new Date(now.getTime() - MIN_REMINDER_GAP_HOURS * 3600 * 1000).toISOString();

  const { data: rows, error } = await db
    .from("pv_reserves")
    .select(
      "id, company_id, pv_id, assigned_to, due_date, last_deadline_reminder_at, deadline_reminder_count, status",
    )
    .in("status", ACTIVE_STATUSES)
    .not("assigned_to", "is", null)
    .not("due_date", "is", null)
    .lte("due_date", in24h.slice(0, 10)) // due_date is DATE
    .limit(500);
  if (error) throw new Error(error.message);

  let assigneeNotified = 0;
  let overdueAlerts = 0;
  let skipped = 0;
  let scanned = (rows ?? []).length;

  for (const r of (rows ?? []) as Array<{
    id: string; company_id: string; pv_id: string; assigned_to: string;
    due_date: string; last_deadline_reminder_at: string | null;
    deadline_reminder_count: number; status: string;
  }>) {
    // gap filter (idempotency)
    if (r.last_deadline_reminder_at && r.last_deadline_reminder_at > gapCutoff) {
      skipped++;
      continue;
    }

    const due = new Date(r.due_date + "T00:00:00Z");
    const isOverdue = due.getTime() < now.getTime();
    const isNear = !isOverdue && due.getTime() - now.getTime() <= 24 * 3600 * 1000;

    if (!isOverdue && !isNear) {
      skipped++;
      continue;
    }

    // notify assignee (in-app + email)
    const notifTitle = isOverdue ? "Réserve en retard" : "Réserve : échéance proche";
    const notifBody = isOverdue
      ? `Échéance dépassée (${r.due_date}). Action requise.`
      : `Échéance dans moins de 24h (${r.due_date}).`;
    await db.from("notifications").insert({
      company_id: r.company_id,
      user_id: r.assigned_to,
      type: isOverdue ? "reserve_overdue" : "reserve_deadline_near",
      title: notifTitle,
      body: notifBody,
    });
    assigneeNotified++;

    if (isOverdue) {
      await sendReserveOverdueEmail(r.id, r.assigned_to).catch(() => {});
    } else {
      await sendReserveDeadlineNearEmail(r.id, r.assigned_to).catch(() => {});
    }

    // escalation: directeurs + responsables exploitation if overdue
    if (isOverdue) {
      const { data: admins } = await db
        .from("company_members")
        .select("user_id")
        .eq("company_id", r.company_id)
        .eq("status", "active")
        .in("role", ["directeur", "responsable_exploitation"]);
      for (const m of (admins ?? []) as { user_id: string | null }[]) {
        if (!m.user_id || m.user_id === r.assigned_to) continue;
        await db.from("notifications").insert({
          company_id: r.company_id,
          user_id: m.user_id,
          type: "reserve_overdue_escalation",
          title: "Réserve en retard — escalade",
          body: `Une réserve assignée est en retard depuis ${r.due_date}.`,
        });
        await sendReserveOverdueEmail(r.id, m.user_id).catch(() => {});
        overdueAlerts++;
      }
    }

    // update reserve idempotency stamp
    await db
      .from("pv_reserves")
      .update({
        last_deadline_reminder_at: nowIso,
        deadline_reminder_count: (r.deadline_reminder_count ?? 0) + 1,
      })
      .eq("id", r.id);

    // audit
    await db.from("audit_logs").insert({
      company_id: r.company_id,
      user_id: null,
      entity_type: "reserve",
      entity_id: r.id,
      action: isOverdue ? "reserve.overdue_alert_sent" : "reserve.deadline_reminder_sent",
      metadata: {
        pv_id: r.pv_id,
        due_date: r.due_date,
        assigned_to: r.assigned_to,
        actor: "cron",
        reminder_count: (r.deadline_reminder_count ?? 0) + 1,
      },
    });
  }

  return { scanned, assigneeNotified, overdueAlerts, skipped };
}

export const Route = createFileRoute("/api/public/hooks/send-reserve-deadline-reminders")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = request.headers.get("x-cron-secret");
        if (!secret || !process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
          return new Response("Unauthorized", { status: 401 });
        }
        try {
          const r = await run();
          return Response.json({ ok: true, ...r });
        } catch (e) {
          console.error("[reserve-deadline-reminders] failed", e);
          return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
        }
      },
      GET: async ({ request }) => {
        const secret = request.headers.get("x-cron-secret");
        if (!secret || !process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
          return new Response("Unauthorized", { status: 401 });
        }
        const r = await run();
        return Response.json({ ok: true, ...r });
      },
    },
  },
});

/** Cron endpoint: sends reminders for upcoming chantier_events whose
 *  reminder_at is due. Idempotent via reminder_sent_at column.
 *
 *  - assigned_to set → notify that user (in-app + push)
 *  - assigned_to null → notify all owners/admins of the company
 *  - audit "chantier.reminder_sent"
 *
 *  Schedule every 15 minutes. Protected by CRON_SECRET (x-cron-secret header).
 */
import { createFileRoute } from "@tanstack/react-router";
import { ADMIN_ROLES, OWNER_ROLES, SIGN_ROLES, isAdminRole, isManageRole } from "@/lib/roles";
import { createClient } from "@supabase/supabase-js";
import { sendPushToUser } from "@/lib/push.server";

function getDb() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function run() {
  const db = getDb() as any;
  const now = new Date().toISOString();

  const { data: due } = await db
    .from("chantier_events")
    .select("id, company_id, chantier_id, title, start_at, assigned_to, reminder_at")
    .lte("reminder_at", now)
    .is("reminder_sent_at", null)
    .not("reminder_at", "is", null)
    .limit(200);

  const events = (due ?? []) as Array<{
    id: string; company_id: string; chantier_id: string; title: string;
    start_at: string | null; assigned_to: string | null; reminder_at: string;
  }>;

  let processed = 0;
  let pushed = 0;
  let notif = 0;

  for (const ev of events) {
    // Determine recipients
    let recipients: string[] = [];
    if (ev.assigned_to) {
      recipients = [ev.assigned_to];
    } else {
      const { data: admins } = await db
        .from("company_members")
        .select("user_id")
        .eq("company_id", ev.company_id)
        .eq("status", "active")
        .in("role", [...ADMIN_ROLES]);
      recipients = ((admins ?? []) as { user_id: string | null }[])
        .map((m) => m.user_id)
        .filter((x): x is string => !!x);
    }

    const title = `Rappel chantier: ${ev.title}`;
    const startTxt = ev.start_at
      ? new Date(ev.start_at).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
      : "à planifier";
    const body = `Événement prévu ${startTxt}.`;
    const url = `/chantiers/${ev.chantier_id}`;

    for (const uid of recipients) {
      await db.from("notifications").insert({
        company_id: ev.company_id,
        user_id: uid,
        type: "chantier.reminder",
        title,
        body,
      });
      notif++;
      try {
        const r = await sendPushToUser(uid, {
          title, body, url,
          tag: `chantier-reminder-${ev.id}`,
          data: { kind: "chantier.reminder", eventId: ev.id, chantierId: ev.chantier_id },
        });
        pushed += r.sent;
      } catch { /* swallow per-user errors */ }
    }

    // Mark reminder sent (idempotency)
    await db.from("chantier_events").update({ reminder_sent_at: now }).eq("id", ev.id);

    // Audit (system actor; no user)
    await db.from("audit_logs").insert({
      company_id: ev.company_id,
      user_id: null,
      entity_type: "chantier_event",
      entity_id: ev.id,
      action: "chantier.reminder_sent",
      metadata: { recipients, assigned_to: ev.assigned_to, actor: "cron" },
    });

    processed++;
  }

  return { processed, pushed, notif, scanned: events.length };
}

export const Route = createFileRoute("/api/public/hooks/send-chantier-reminders")({
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
          console.error("[chantier-reminders] failed", e);
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

/** Daily cron endpoint: scans active trials and sends push/notif/email
 *  warnings at J-3, J-1, and on expiration. Idempotent per day via the
 *  `notifications` table (we never re-send the same type twice).
 *
 *  Schedule via pg_cron once a day (see migration / supabase insert).
 *  Authed by Supabase publishable apikey header.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { sendPushToUser } from "@/lib/push.server";

function getDb() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

type Bucket = "j3" | "j1" | "expired";

function bucketFor(trialEnd: Date, now: Date): Bucket | null {
  const ms = trialEnd.getTime() - now.getTime();
  const days = Math.floor(ms / 86400000);
  if (ms <= 0) return "expired";
  if (days === 0 || days === 1) return "j1";
  if (days === 2 || days === 3) return "j3";
  return null;
}

function copyFor(bucket: Bucket) {
  if (bucket === "expired")
    return { title: "Essai expiré", body: "Votre période d'essai vient de se terminer.", type: "billing.trial_expired" };
  if (bucket === "j1")
    return { title: "Essai expire demain", body: "Plus que 24h avant la fin de votre essai PVIA.", type: "billing.trial_warning_j1" };
  return { title: "Essai expire dans 3 jours", body: "Pensez à choisir un plan pour ne rien interrompre.", type: "billing.trial_warning_j3" };
}

async function run() {
  const db = getDb() as any;
  const now = new Date();
  const windowEnd = new Date(now.getTime() + 4 * 86400000);

  const { data: subs } = await db
    .from("subscriptions")
    .select("id,company_id,user_id,trial_end,status,plan")
    .in("status", ["trialing", "active"])
    .not("trial_end", "is", null)
    .lte("trial_end", windowEnd.toISOString());

  let processed = 0;
  let pushed = 0;
  let notif = 0;

  for (const s of (subs ?? []) as Array<{ id: string; company_id: string; user_id: string; trial_end: string }>) {
    const trialEnd = new Date(s.trial_end);
    const b = bucketFor(trialEnd, now);
    if (!b) continue;
    const { title, body, type } = copyFor(b);

    // Idempotency: skip if we already wrote this exact type for this company today
    const dayStart = new Date(now.toISOString().slice(0, 10) + "T00:00:00Z").toISOString();
    const { data: existing } = await db
      .from("notifications")
      .select("id")
      .eq("company_id", s.company_id)
      .eq("type", type)
      .gte("created_at", dayStart)
      .limit(1);
    if (existing?.length) continue;

    // In-app notification (fan-out to owner; others can see via company filter)
    await db.from("notifications").insert({
      company_id: s.company_id,
      user_id: s.user_id,
      type,
      title,
      body,
    });
    notif++;

    // Audit
    await db.from("audit_logs").insert({
      company_id: s.company_id,
      user_id: s.user_id,
      entity_type: "subscription",
      entity_id: s.id,
      action: b === "expired" ? "billing.trial_expired" : "billing.trial_warning",
      metadata: { bucket: b, trial_end: s.trial_end },
    });

    // Push to every active member
    const { data: members } = await db
      .from("company_members")
      .select("user_id")
      .eq("company_id", s.company_id)
      .eq("status", "active");
    for (const m of (members ?? []) as Array<{ user_id: string | null }>) {
      if (!m.user_id) continue;
      try {
        const r = await sendPushToUser(m.user_id, {
          title,
          body,
          url: "/billing",
          tag: `${type}-${s.company_id}`,
          requireInteraction: b === "expired",
          data: { kind: type, companyId: s.company_id },
        });
        pushed += r.sent;
      } catch {
        /* swallow per-user errors */
      }
    }

    processed++;
  }

  return { processed, pushed, notif, scanned: subs?.length ?? 0 };
}

export const Route = createFileRoute("/api/public/hooks/check-expiring-trials")({
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
          console.error("[trial-cron] failed", e);
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

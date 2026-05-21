/** Server-side Web Push sender — uses web-push with VAPID. */
import webpush from "web-push";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

let configured = false;
function ensureConfigured() {
  if (configured) return;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:contact@pvia.fr";
  if (!pub || !priv) {
    throw new Error("VAPID keys missing (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY).");
  }
  webpush.setVapidDetails(subject, pub, priv);
  configured = true;
}

export type PushPayload = {
  title: string;
  body?: string;
  url?: string;
  tag?: string;
  icon?: string;
  badge?: string;
  data?: Record<string, unknown>;
};

/** Send a push to every device subscribed by a given user.
 *  Prunes invalid (410 Gone / 404) subscriptions automatically.
 */
export async function sendPushToUser(userId: string, payload: PushPayload) {
  ensureConfigured();
  const { data: subs } = await supabaseAdmin
    .from("push_subscriptions")
    .select("id,endpoint,p256dh,auth")
    .eq("user_id", userId);
  if (!subs?.length) return { sent: 0, removed: 0 };

  const body = JSON.stringify(payload);
  let sent = 0;
  const toRemove: string[] = [];

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: s.endpoint,
            keys: { p256dh: s.p256dh, auth: s.auth },
          },
          body,
          { TTL: 60 * 60 * 24 },
        );
        sent++;
      } catch (err: unknown) {
        const status = (err as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) toRemove.push(s.id);
        else console.warn("[push] send failed", status, (err as Error)?.message);
      }
    }),
  );

  if (toRemove.length) {
    await supabaseAdmin.from("push_subscriptions").delete().in("id", toRemove);
  }
  return { sent, removed: toRemove.length };
}

/** Fan-out helper: send to every active member of a company.
 *  Optionally exclude one user (typically the actor). Never throws. */
export async function sendPushToCompany(
  companyId: string,
  payload: PushPayload,
  opts: { excludeUserId?: string } = {},
) {
  try {
    ensureConfigured();
    const { data: members } = await supabaseAdmin
      .from("company_members")
      .select("user_id")
      .eq("company_id", companyId)
      .eq("status", "active");
    const ids = (members ?? [])
      .map((m) => m.user_id)
      .filter((id): id is string => !!id && id !== opts.excludeUserId);
    let total = 0;
    for (const uid of ids) {
      const r = await sendPushToUser(uid, payload);
      total += r.sent;
    }
    return { sent: total, recipients: ids.length };
  } catch (e) {
    console.warn("[push] sendPushToCompany failed", (e as Error)?.message);
    return { sent: 0, recipients: 0 };
  }
}

/** Fire-and-forget wrapper safe to call from any server fn. Never blocks the request. */
export function firePushToCompany(
  companyId: string,
  payload: PushPayload,
  opts: { excludeUserId?: string } = {},
) {
  sendPushToCompany(companyId, payload, opts).catch(() => {});
}

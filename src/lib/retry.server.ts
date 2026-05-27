/**
 * Auto-retry helpers for failed emails and webhook deliveries.
 * Called by /api/public/hooks/drain-emails and /api/public/hooks/drain-webhooks
 * (protected by CRON_SECRET). Never throws — all errors are swallowed and audited.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const EMAIL_MAX_DEFAULT = 5;
const WEBHOOK_MAX_DEFAULT = 5;

// Exponential backoff: 1m, 5m, 15m, 1h, 6h
function emailBackoffMinutes(attempts: number): number {
  const steps = [1, 5, 15, 60, 360];
  return steps[Math.min(attempts, steps.length - 1)];
}

async function audit(action: string, companyId: string | null, entityType: string, entityId: string, meta: Record<string, unknown>) {
  try {
    await supabaseAdmin.from("audit_logs").insert({
      company_id: companyId,
      entity_type: entityType,
      entity_id: entityId,
      action,
      metadata: meta,
    });
  } catch {}
}

/* ------------------------------------------------------------------ */
/* Emails                                                              */
/* ------------------------------------------------------------------ */

type EmailPayload = {
  from: string;
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  // attachments are intentionally NOT supported here: PDFs are too large for log storage
};

async function sendViaResend(payload: EmailPayload): Promise<{ ok: boolean; status?: number; id?: string; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: "RESEND_API_KEY missing" };
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const body = (await r.text().catch(() => "")).slice(0, 500);
      return { ok: false, status: r.status, error: `${r.status}: ${body}` };
    }
    const j = (await r.json().catch(() => ({}))) as { id?: string };
    return { ok: true, status: r.status, id: j.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function drainFailedEmails(limit = 50): Promise<{ scanned: number; retried: number; sent: number; dead: number }> {
  const nowIso = new Date().toISOString();
  const { data: rows } = await supabaseAdmin
    .from("email_logs")
    .select("id,company_id,recipient_email,email_type,subject,retries_count,max_retries,payload,error_message")
    .in("status", ["failed", "retrying"])
    .not("payload", "is", null)
    .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`)
    .order("created_at", { ascending: true })
    .limit(limit);

  const list = (rows ?? []) as any[];
  let retried = 0;
  let sent = 0;
  let dead = 0;

  for (const row of list) {
    const max = row.max_retries ?? EMAIL_MAX_DEFAULT;
    const attempts = (row.retries_count ?? 0) + 1;
    const payload = row.payload as EmailPayload | null;
    if (!payload) continue;

    retried++;
    const r = await sendViaResend(payload);

    if (r.ok) {
      sent++;
      await supabaseAdmin
        .from("email_logs")
        .update({
          status: "sent",
          retries_count: attempts,
          next_retry_at: null,
          sent_at: new Date().toISOString(),
          resend_id: r.id ?? null,
          error_message: null,
        })
        .eq("id", row.id);
      await audit("email.delivery_retried", row.company_id, "email", row.id, {
        attempts,
        outcome: "sent",
        email_type: row.email_type,
      });
      continue;
    }

    const giveUp = attempts >= max;
    if (giveUp) {
      dead++;
      await supabaseAdmin
        .from("email_logs")
        .update({
          status: "dead",
          retries_count: attempts,
          next_retry_at: null,
          error_message: r.error ?? "unknown",
        })
        .eq("id", row.id);
      await audit("email.delivery_dead", row.company_id, "email", row.id, {
        attempts,
        last_error: r.error ?? null,
        email_type: row.email_type,
      });
    } else {
      const nextAt = new Date(Date.now() + emailBackoffMinutes(attempts) * 60_000).toISOString();
      await supabaseAdmin
        .from("email_logs")
        .update({
          status: "retrying",
          retries_count: attempts,
          next_retry_at: nextAt,
          error_message: r.error ?? null,
        })
        .eq("id", row.id);
      await audit("email.delivery_retried", row.company_id, "email", row.id, {
        attempts,
        outcome: "scheduled",
        next_at: nextAt,
        last_error: r.error ?? null,
        email_type: row.email_type,
      });
    }
  }

  return { scanned: list.length, retried, sent, dead };
}

/* ------------------------------------------------------------------ */
/* Webhooks                                                            */
/* ------------------------------------------------------------------ */

export async function drainPendingWebhooks(limit = 100): Promise<{ scanned: number; delivered: number; retried: number; dead: number }> {
  const { deliverOne } = await import("./webhooks.server");
  const nowIso = new Date().toISOString();

  const { data: rows } = await supabaseAdmin
    .from("webhook_deliveries")
    .select("id,company_id,event,attempts,max_attempts,status")
    .in("status", ["pending", "retrying"])
    .lte("next_attempt_at", nowIso)
    .order("created_at", { ascending: true })
    .limit(limit);

  const list = (rows ?? []) as any[];
  let delivered = 0;
  let retried = 0;
  let dead = 0;

  for (const row of list) {
    const before = row.attempts ?? 0;
    const max = row.max_attempts ?? WEBHOOK_MAX_DEFAULT;
    const r = await deliverOne(row.id).catch((e) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));

    // Re-read row to see new status set by deliverOne.
    const { data: after } = await supabaseAdmin
      .from("webhook_deliveries")
      .select("status,attempts,error,response_code")
      .eq("id", row.id)
      .maybeSingle();

    if (after?.status === "delivered") {
      delivered++;
      continue;
    }

    // deliverOne marks 'failed' as terminal once max attempts reached. Upgrade
    // semantic to 'dead' for terminal so the UI/cron can distinguish.
    const attempts = after?.attempts ?? before + 1;
    if (after?.status === "failed" || attempts >= max) {
      dead++;
      await supabaseAdmin
        .from("webhook_deliveries")
        .update({ status: "dead" })
        .eq("id", row.id);
      await audit("webhook.delivery_dead", row.company_id, "webhook_delivery", row.id, {
        attempts,
        event: row.event,
        last_error: after?.error ?? null,
        response_code: after?.response_code ?? null,
      });
    } else {
      retried++;
      // Normalize transient state to 'retrying' so UI can show "retry scheduled".
      if (after?.status === "pending") {
        await supabaseAdmin.from("webhook_deliveries").update({ status: "retrying" }).eq("id", row.id);
      }
      await audit("webhook.delivery_retried", row.company_id, "webhook_delivery", row.id, {
        attempts,
        event: row.event,
        last_error: after?.error ?? null,
        response_code: after?.response_code ?? null,
      });
    }
  }

  return { scanned: list.length, delivered, retried, dead };
}

/**
 * Centralized email sender that:
 *  - calls Resend
 *  - logs to email_logs (status, retries_count, error_message, resend_id)
 *  - optionally stores a `payload` jsonb that the auto-retry worker
 *    (drainFailedEmails) can replay without any app context.
 *
 * Security rules:
 *  - NEVER store secrets, raw OTP codes, or anything you wouldn't email.
 *    The payload mirrors what was already sent to the recipient — no more.
 *  - Emails carrying large attachments (signed PV PDF, reserve-lift PDF)
 *    must NOT be stored payload-side. They are logged with payload=null
 *    and surface in the admin UI as "manual_required".
 *  - All callers are server-only (.server.ts / serverFn handlers).
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type SimpleEmailPayload = {
  from: string;
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  html?: string;
  text?: string;
};

export type SendEmailWithRetryLogOpts = {
  /** Email type (denormalised tag for filtering / KPIs) */
  emailType: string;
  /** Owning company (for RLS / per-company KPIs). null = platform email. */
  companyId?: string | null;
  /** Optional PV link (for /support/$companyId timeline correlation) */
  pvId?: string | null;
  /** The Resend payload to send. Used both for the live send AND, if
   *  `retryable` is true, persisted to email_logs.payload for replay. */
  payload: SimpleEmailPayload;
  /**
   * Whether the payload is safe + sufficient to replay without app context.
   * Set to false for:
   *   - OTP codes (one-time secret in body)
   *   - emails with attachments not embedded in the payload
   *   - anything time-sensitive that should not auto-resend after delay
   */
  retryable: boolean;
  /** Override default 5 retry attempts. */
  maxRetries?: number;
};

export type SendEmailResult = {
  status: "sent" | "failed";
  logId: string | null;
  resendId?: string | null;
  error?: string;
};

/**
 * Send via Resend, log to email_logs, and (if retryable) persist payload
 * so the retry cron can replay on failure.
 */
export async function sendEmailWithRetryLog(
  opts: SendEmailWithRetryLogOpts,
): Promise<SendEmailResult> {
  const recipient = Array.isArray(opts.payload.to)
    ? opts.payload.to[0]
    : opts.payload.to;
  const subject = opts.payload.subject;
  const max = opts.maxRetries ?? 5;
  const storedPayload = opts.retryable ? opts.payload : null;

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    const { data: row } = await supabaseAdmin
      .from("email_logs")
      .insert({
        company_id: opts.companyId ?? null,
        pv_id: opts.pvId ?? null,
        recipient_email: recipient,
        email_type: opts.emailType,
        subject,
        status: "failed",
        error_message: "RESEND_API_KEY missing",
        payload: storedPayload as never,
        max_retries: max,
        retries_count: 0,
        next_retry_at: opts.retryable ? new Date(Date.now() + 60_000).toISOString() : null,
      } as never)
      .select("id")
      .single();
    return {
      status: "failed",
      logId: (row as any)?.id ?? null,
      error: "RESEND_API_KEY missing",
    };
  }

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(opts.payload),
    });
    if (!r.ok) {
      const body = (await r.text().catch(() => "")).slice(0, 500);
      const err = `${r.status}: ${body}`;
      const { data: row } = await supabaseAdmin
        .from("email_logs")
        .insert({
          company_id: opts.companyId ?? null,
          pv_id: opts.pvId ?? null,
          recipient_email: recipient,
          email_type: opts.emailType,
          subject,
          status: "failed",
          error_message: err,
          payload: storedPayload as never,
          max_retries: max,
          retries_count: 0,
          next_retry_at: opts.retryable ? new Date(Date.now() + 60_000).toISOString() : null,
        } as never)
        .select("id")
        .single();
      return { status: "failed", logId: (row as any)?.id ?? null, error: err };
    }
    const j = (await r.json().catch(() => ({}))) as { id?: string };
    const { data: row } = await supabaseAdmin
      .from("email_logs")
      .insert({
        company_id: opts.companyId ?? null,
        pv_id: opts.pvId ?? null,
        recipient_email: recipient,
        email_type: opts.emailType,
        subject,
        status: "sent",
        resend_id: j.id ?? null,
        sent_at: new Date().toISOString(),
        // Sent OK — no need to keep the payload around for retry.
        payload: null,
        max_retries: max,
        retries_count: 0,
      } as never)
      .select("id")
      .single();
    return {
      status: "sent",
      logId: (row as any)?.id ?? null,
      resendId: j.id ?? null,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const { data: row } = await supabaseAdmin
      .from("email_logs")
      .insert({
        company_id: opts.companyId ?? null,
        pv_id: opts.pvId ?? null,
        recipient_email: recipient,
        email_type: opts.emailType,
        subject,
        status: "failed",
        error_message: msg,
        payload: storedPayload as never,
        max_retries: max,
        retries_count: 0,
        next_retry_at: opts.retryable ? new Date(Date.now() + 60_000).toISOString() : null,
      } as never)
      .select("id")
      .single();
    return { status: "failed", logId: (row as any)?.id ?? null, error: msg };
  }
}

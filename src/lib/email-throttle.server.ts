import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * EM-M2/EM-M3 — Idempotency guard for manual email resends.
 *
 * Looks at email_logs for a recent successful send matching the
 * (emailType, pvId|companyId, recipient?) tuple. If one exists within
 * `windowSec`, throw with a friendly message instead of sending again.
 *
 * `status` accepted: anything not "failed" (sent / pending / retrying).
 */
export async function assertNotRecentlySent(opts: {
  emailType: string;
  pvId?: string | null;
  companyId?: string | null;
  recipient?: string | null;
  windowSec?: number;
  label?: string;
}): Promise<void> {
  const windowSec = opts.windowSec ?? 60;
  const since = new Date(Date.now() - windowSec * 1000).toISOString();

  let q = supabaseAdmin
    .from("email_logs")
    .select("id,created_at,status,recipient_email")
    .eq("email_type", opts.emailType)
    .gte("created_at", since)
    .neq("status", "failed")
    .limit(1);

  if (opts.pvId) q = q.eq("pv_id", opts.pvId);
  if (opts.companyId && !opts.pvId) q = q.eq("company_id", opts.companyId);
  if (opts.recipient) q = q.eq("recipient_email", opts.recipient.toLowerCase());

  const { data } = await q;
  if (data && data.length > 0) {
    const label = opts.label ?? "Cet email";
    throw new Error(
      `${label} a déjà été envoyé il y a moins de ${windowSec}s. Réessayez dans un instant.`,
    );
  }
}

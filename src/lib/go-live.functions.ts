import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requirePlatformAdmin } from "./admin-guard.server";

export type GoLiveVerdict = "blocked" | "ready_with_warnings" | "ready_for_production";

export type GoLiveStatus = {
  generatedAt: string;
  checklist: { total: number; passed: number; failed: number; todo: number; pct: number };
  emails: { sent: number; retrying: number; failed: number; dead: number };
  webhooks: { delivered: number; pending: number; retrying: number; failed: number; dead: number };
  appErrors: { criticalOpen: number; last24h: number };
  config: {
    stripe: boolean;
    resend: boolean;
    vapid: boolean;
    cronSecret: boolean;
    publicAppUrl: boolean;
  };
  totals: { companies: number; pvSigned: number; pvTotal: number };
  lastTestedAt: string | null;
  verdict: GoLiveVerdict;
  blockers: string[];
  warnings: string[];
};

async function safeCount(builder: any): Promise<number> {
  const { count, error } = await builder;
  if (error) return 0;
  return count ?? 0;
}

export const getGoLiveStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<GoLiveStatus> => {
    await requirePlatformAdmin(context.userId);

    const last24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

    // Checklist
    const { data: chkRows } = await supabaseAdmin
      .from("launch_checklist_items")
      .select("status,tested_at");
    const chk = chkRows ?? [];
    const total = chk.length;
    const passed = chk.filter((r) => r.status === "passed").length;
    const failed = chk.filter((r) => r.status === "failed").length;
    const todo = chk.filter((r) => r.status === "todo").length;
    const pct = total ? Math.round((passed / total) * 100) : 0;
    const lastTestedAt =
      chk.map((r) => r.tested_at).filter(Boolean).sort().reverse()[0] ?? null;

    // Emails
    const [eSent, eRetry, eFailed, eDead] = await Promise.all([
      safeCount(
        supabaseAdmin.from("email_logs").select("id", { count: "exact", head: true }).eq("status", "sent"),
      ),
      safeCount(
        supabaseAdmin.from("email_logs").select("id", { count: "exact", head: true }).eq("status", "retrying"),
      ),
      safeCount(
        supabaseAdmin.from("email_logs").select("id", { count: "exact", head: true }).eq("status", "failed"),
      ),
      safeCount(
        supabaseAdmin.from("email_logs").select("id", { count: "exact", head: true }).eq("status", "dead"),
      ),
    ]);

    // Webhooks
    const [wDelivered, wPending, wRetry, wFailed, wDead] = await Promise.all([
      safeCount(
        supabaseAdmin.from("webhook_deliveries").select("id", { count: "exact", head: true }).eq("status", "delivered"),
      ),
      safeCount(
        supabaseAdmin.from("webhook_deliveries").select("id", { count: "exact", head: true }).eq("status", "pending"),
      ),
      safeCount(
        supabaseAdmin.from("webhook_deliveries").select("id", { count: "exact", head: true }).eq("status", "retrying"),
      ),
      safeCount(
        supabaseAdmin.from("webhook_deliveries").select("id", { count: "exact", head: true }).eq("status", "failed"),
      ),
      safeCount(
        supabaseAdmin.from("webhook_deliveries").select("id", { count: "exact", head: true }).eq("status", "dead"),
      ),
    ]);

    // Errors
    const [criticalOpen, errors24h] = await Promise.all([
      safeCount(
        supabaseAdmin
          .from("app_errors")
          .select("id", { count: "exact", head: true })
          .eq("severity", "critical")
          .eq("resolved", false),
      ),
      safeCount(
        supabaseAdmin
          .from("app_errors")
          .select("id", { count: "exact", head: true })
          .gte("created_at", last24h),
      ),
    ]);

    // Totals
    const [companies, pvTotal, pvSigned] = await Promise.all([
      safeCount(supabaseAdmin.from("companies").select("id", { count: "exact", head: true })),
      safeCount(supabaseAdmin.from("pv").select("id", { count: "exact", head: true })),
      safeCount(
        supabaseAdmin.from("pv").select("id", { count: "exact", head: true }).eq("status", "signe"),
      ),
    ]);

    const config = {
      stripe: !!(process.env.STRIPE_LIVE_API_KEY || process.env.STRIPE_SANDBOX_API_KEY),
      resend: !!process.env.RESEND_API_KEY,
      vapid: !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
      cronSecret: !!process.env.CRON_SECRET,
      publicAppUrl: !!process.env.PUBLIC_APP_URL,
    };

    const blockers: string[] = [];
    const warnings: string[] = [];

    if (pct < 100) {
      if (pct < 50) blockers.push(`Checklist trop incomplète (${pct}%)`);
      else warnings.push(`Checklist incomplète (${pct}%)`);
    }
    if (failed > 0) blockers.push(`${failed} test(s) checklist en échec`);
    if (eDead > 0) blockers.push(`${eDead} email(s) en dead-letter`);
    if (wDead > 0) blockers.push(`${wDead} webhook(s) en dead-letter`);
    if (criticalOpen > 0) blockers.push(`${criticalOpen} erreur(s) critique(s) ouverte(s)`);
    if (!config.stripe) blockers.push("Stripe non configuré");
    if (!config.resend) blockers.push("Resend non configuré");
    if (!config.cronSecret) warnings.push("CRON_SECRET absent");
    if (!config.vapid) warnings.push("VAPID push non configuré");
    if (!config.publicAppUrl) warnings.push("PUBLIC_APP_URL absent");
    if (eFailed > 0) warnings.push(`${eFailed} email(s) en échec (non-dead)`);
    if (wFailed > 0) warnings.push(`${wFailed} webhook(s) en échec (non-dead)`);

    let verdict: GoLiveVerdict;
    if (blockers.length > 0) verdict = "blocked";
    else if (warnings.length > 0 || pct < 100) verdict = "ready_with_warnings";
    else verdict = "ready_for_production";

    return {
      generatedAt: new Date().toISOString(),
      checklist: { total, passed, failed, todo, pct },
      emails: { sent: eSent, retrying: eRetry, failed: eFailed, dead: eDead },
      webhooks: { delivered: wDelivered, pending: wPending, retrying: wRetry, failed: wFailed, dead: wDead },
      appErrors: { criticalOpen, last24h: errors24h },
      config,
      totals: { companies, pvSigned, pvTotal },
      lastTestedAt,
      verdict,
      blockers,
      warnings,
    };
  });

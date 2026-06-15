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
    stripeLiveOk: boolean;
    stripeLivePresent: boolean;
    resend: boolean;
    resendFromEmail: boolean;
    vapid: boolean;
    cronSecret: boolean;
    publicAppUrl: boolean;
    publicAppUrlValue: string | null;
    appEnv: "local" | "preview" | "production";
    appEnvExplicit: boolean;
    viteAppEnv: string | null;
    expectedStripeEnv: "sandbox" | "live";
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

    const { checkStripeEnv } = await import("./stripe.server");
    const { getServerAppEnv, getServerStripeEnv } = await import("./app-env.server");
    const appEnv = getServerAppEnv();
    const expectedStripeEnv = getServerStripeEnv();
    const appEnvExplicit = !!process.env.APP_ENV;
    const stripeSandbox = checkStripeEnv("sandbox");
    const stripeLive = checkStripeEnv("live");
    const config = {
      stripe: !!(process.env.STRIPE_LIVE_API_KEY || process.env.STRIPE_SANDBOX_API_KEY),
      stripeLiveOk: stripeLive.ok,
      stripeLivePresent: !!process.env.STRIPE_LIVE_API_KEY,
      resend: !!process.env.RESEND_API_KEY,
      resendFromEmail: !!process.env.RESEND_FROM_EMAIL,
      vapid: !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
      cronSecret: !!process.env.CRON_SECRET,
      publicAppUrl: !!process.env.PUBLIC_APP_URL,
      publicAppUrlValue: process.env.PUBLIC_APP_URL ?? null,
      appEnv,
      appEnvExplicit,
      viteAppEnv: (import.meta.env.VITE_APP_ENV as string | undefined) ?? null,
      expectedStripeEnv,
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
    // ST-C4: block publication on Stripe env mismatch (live takes precedence
    // since prod will use live keys).
    if (process.env.STRIPE_LIVE_API_KEY && !stripeLive.ok) {
      blockers.push(`Stripe LIVE incohérent : ${stripeLive.errors.join("; ")}`);
    }
    if (process.env.STRIPE_SANDBOX_API_KEY && !stripeSandbox.ok) {
      warnings.push(`Stripe SANDBOX incohérent : ${stripeSandbox.errors.join("; ")}`);
    }
    if (!config.resend) blockers.push("Resend non configuré");
    if (!config.resendFromEmail) warnings.push("RESEND_FROM_EMAIL absent");
    if (!config.cronSecret) warnings.push("CRON_SECRET absent");
    if (!config.vapid) warnings.push("VAPID push non configuré");
    if (!config.publicAppUrl) warnings.push("PUBLIC_APP_URL absent");
    if (!appEnvExplicit) warnings.push("APP_ENV absent (détection fallback par hostname)");
    if (!config.viteAppEnv) warnings.push("VITE_APP_ENV absent (build front)");
    if (appEnv === "production" && !process.env.STRIPE_LIVE_API_KEY) {
      blockers.push("APP_ENV=production mais STRIPE_LIVE_API_KEY absent");
    }
    if (appEnv !== "production" && process.env.STRIPE_LIVE_API_KEY && expectedStripeEnv === "live") {
      blockers.push("Incohérence APP_ENV / Stripe live");
    }
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

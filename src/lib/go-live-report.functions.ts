import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requirePlatformAdmin } from "./admin-guard.server";

export type GoLiveReport = {
  generatedAt: string;
  security: {
    legacyAdminRoles: number;
    platformAdmins: number;
    impersonationOpen: number;
  };
  compliance: { total: number; done: number; pct: number };
  emails: { sent: number; retrying: number; failed: number; dead: number };
  webhooks: { delivered: number; pending: number; retrying: number; failed: number; dead: number; enabled: number };
  stripe: { sandboxKey: boolean; liveKey: boolean; activeSubs: number; trialingSubs: number };
  storage: { pvAssetsAvailable: boolean; logosAvailable: boolean };
  pv: {
    total: number;
    signed: number;
    locked: number;
    remoteSignatures: number;
    onsiteSignatures: number;
    reservesOpen: number;
    reservesLifted: number;
  };
  risks: string[];
  decision: "blocked" | "ready_with_warnings" | "ready_for_production";
};

async function safeCount(builder: any): Promise<number> {
  const { count, error } = await builder;
  if (error) return 0;
  return count ?? 0;
}

export const getGoLiveReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<GoLiveReport> => {
    await requirePlatformAdmin(context.userId);

    // Security
    const [legacyAdminRoles, platformAdmins, impersonationOpen] = await Promise.all([
      safeCount(supabaseAdmin.from("user_roles").select("user_id", { count: "exact", head: true }).eq("role", "admin")),
      safeCount(
        supabaseAdmin.from("user_roles").select("user_id", { count: "exact", head: true }).eq("role", "platform_admin"),
      ),
      safeCount(
        supabaseAdmin
          .from("impersonation_sessions")
          .select("id", { count: "exact", head: true })
          .is("ended_at", null),
      ),
    ]);

    // Compliance
    const { data: compRows } = await supabaseAdmin
      .from("compliance_checklist_items")
      .select("status");
    const compTotal = compRows?.length ?? 0;
    const compDone = (compRows ?? []).filter((r: any) => r.status === "done" || r.status === "passed").length;
    const compPct = compTotal ? Math.round((compDone / compTotal) * 100) : 0;

    // Emails
    const [eSent, eRetry, eFailed, eDead] = await Promise.all([
      safeCount(supabaseAdmin.from("email_logs").select("id", { count: "exact", head: true }).eq("status", "sent")),
      safeCount(supabaseAdmin.from("email_logs").select("id", { count: "exact", head: true }).eq("status", "retrying")),
      safeCount(supabaseAdmin.from("email_logs").select("id", { count: "exact", head: true }).eq("status", "failed")),
      safeCount(supabaseAdmin.from("email_logs").select("id", { count: "exact", head: true }).eq("status", "dead")),
    ]);

    // Webhooks
    const [wDelivered, wPending, wRetry, wFailed, wDead, wEnabled] = await Promise.all([
      safeCount(supabaseAdmin.from("webhook_deliveries").select("id", { count: "exact", head: true }).eq("status", "delivered")),
      safeCount(supabaseAdmin.from("webhook_deliveries").select("id", { count: "exact", head: true }).eq("status", "pending")),
      safeCount(supabaseAdmin.from("webhook_deliveries").select("id", { count: "exact", head: true }).eq("status", "retrying")),
      safeCount(supabaseAdmin.from("webhook_deliveries").select("id", { count: "exact", head: true }).eq("status", "failed")),
      safeCount(supabaseAdmin.from("webhook_deliveries").select("id", { count: "exact", head: true }).eq("status", "dead")),
      safeCount(supabaseAdmin.from("webhooks").select("id", { count: "exact", head: true }).eq("enabled", true)),
    ]);

    // Stripe
    const [activeSubs, trialingSubs] = await Promise.all([
      safeCount(supabaseAdmin.from("subscriptions").select("id", { count: "exact", head: true }).eq("status", "active")),
      safeCount(supabaseAdmin.from("subscriptions").select("id", { count: "exact", head: true }).eq("status", "trialing")),
    ]);

    // Storage probes
    let pvAssetsAvailable = false;
    let logosAvailable = false;
    try {
      const r = await supabaseAdmin.storage.from("pv-assets").list("", { limit: 1 });
      pvAssetsAvailable = !r.error;
    } catch {}
    try {
      const r = await supabaseAdmin.storage.from("company-logos").list("", { limit: 1 });
      logosAvailable = !r.error;
    } catch {}

    // PV
    const [pvTotal, pvSigned, pvLocked, pvRemote, pvOnsite, resOpen, resLifted] = await Promise.all([
      safeCount(supabaseAdmin.from("pv").select("id", { count: "exact", head: true })),
      safeCount(supabaseAdmin.from("pv").select("id", { count: "exact", head: true }).eq("status", "signe")),
      safeCount(supabaseAdmin.from("pv").select("id", { count: "exact", head: true }).not("locked_at", "is", null)),
      safeCount(supabaseAdmin.from("pv").select("id", { count: "exact", head: true }).eq("signature_mode", "remote")),
      safeCount(supabaseAdmin.from("pv").select("id", { count: "exact", head: true }).eq("signature_mode", "onsite")),
      safeCount(supabaseAdmin.from("pv_reserves").select("id", { count: "exact", head: true }).eq("status", "ouverte")),
      safeCount(
        supabaseAdmin
          .from("pv_reserves")
          .select("id", { count: "exact", head: true })
          .in("status", ["levee", "validee"]),
      ),
    ]);

    const risks: string[] = [];
    if (legacyAdminRoles > 0) risks.push(`${legacyAdminRoles} compte(s) avec ancien rôle 'admin' (legacy)`);
    if (platformAdmins === 0) risks.push("Aucun platform_admin défini — accès cockpit vide");
    if (eDead > 0) risks.push(`${eDead} email(s) en dead-letter`);
    if (wDead > 0) risks.push(`${wDead} webhook(s) en dead-letter`);
    if (!pvAssetsAvailable) risks.push("Bucket pv-assets injoignable");
    if (!process.env.STRIPE_LIVE_API_KEY) risks.push("Stripe LIVE non configuré (sandbox uniquement)");
    if (!process.env.RESEND_API_KEY) risks.push("Resend non configuré");
    if (compPct < 100 && compTotal > 0) risks.push(`Conformité ${compPct}%`);

    let decision: GoLiveReport["decision"] = "ready_for_production";
    if (
      eDead > 0 ||
      wDead > 0 ||
      legacyAdminRoles > 0 ||
      platformAdmins === 0 ||
      !pvAssetsAvailable ||
      !process.env.RESEND_API_KEY
    ) {
      decision = "blocked";
    } else if (risks.length > 0) {
      decision = "ready_with_warnings";
    }

    return {
      generatedAt: new Date().toISOString(),
      security: { legacyAdminRoles, platformAdmins, impersonationOpen },
      compliance: { total: compTotal, done: compDone, pct: compPct },
      emails: { sent: eSent, retrying: eRetry, failed: eFailed, dead: eDead },
      webhooks: {
        delivered: wDelivered,
        pending: wPending,
        retrying: wRetry,
        failed: wFailed,
        dead: wDead,
        enabled: wEnabled,
      },
      stripe: {
        sandboxKey: !!process.env.STRIPE_SANDBOX_API_KEY,
        liveKey: !!process.env.STRIPE_LIVE_API_KEY,
        activeSubs,
        trialingSubs,
      },
      storage: { pvAssetsAvailable, logosAvailable },
      pv: {
        total: pvTotal,
        signed: pvSigned,
        locked: pvLocked,
        remoteSignatures: pvRemote,
        onsiteSignatures: pvOnsite,
        reservesOpen: resOpen,
        reservesLifted: resLifted,
      },
      risks,
      decision,
    };
  });

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { writeAuditLog } from "./audit.server";

/**
 * Backend quota & feature gates. Called from server functions before any
 * action that consumes plan quota or requires a premium feature.
 * Sources truth from public.plan_limits + public.subscriptions via RPCs.
 */

export type PlanFeature =
  | "remote_sign"
  | "advanced_stats"
  | "export_audit"
  | "branding"
  | "technical_visits";

export type AccessState =
  | "free"            // no subscription row → free starter tier
  | "trialing"        // in trial window
  | "active"          // paid & current
  | "canceled_grace"  // canceled but period_end still in future
  | "past_due"        // payment failed, blocked
  | "unpaid"          // retries exhausted, blocked
  | "trial_expired"   // trialing past trial_end, blocked
  | "canceled"        // canceled & period ended, blocked
  | "incomplete"      // initial payment never succeeded, blocked
  | "incomplete_expired"
  | "paused"
  | "blocked";

export type AccessInfo = {
  state: AccessState;
  plan: string;
  blocked: boolean;
  trial_end: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  status: string | null;
};

/**
 * Computes the authoritative access state for a company.
 * Differentiates between "never paid → free tier" and "paid then lapsed → blocked".
 */
export async function getAccessState(companyId: string): Promise<AccessInfo> {
  const [{ data: sub }, { data: company }] = await Promise.all([
    supabaseAdmin
      .from("subscriptions")
      .select("status,plan,current_period_end,trial_end,cancel_at_period_end")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from("companies")
      .select("created_at,trial_ends_at")
      .eq("id", companyId)
      .maybeSingle(),
  ]);

  if (!sub) {
    // Aucun abonnement Stripe : l'entreprise vit sur son essai gratuit de 14 j.
    // Pas de formule gratuite permanente — à l'expiration, lecture seule.
    const trialEndIso =
      ((company as any)?.trial_ends_at as string | null) ??
      ((company as any)?.created_at
        ? new Date(new Date((company as any).created_at as string).getTime() + 14 * 86_400_000).toISOString()
        : null);
    const active = trialEndIso ? new Date(trialEndIso).getTime() > Date.now() : false;
    return {
      state: active ? "trialing" : "trial_expired",
      plan: "starter",
      blocked: !active,
      trial_end: trialEndIso,
      current_period_end: null,
      cancel_at_period_end: false,
      status: active ? "trialing" : null,
    };
  }


  const now = Date.now();
  const periodEnd = sub.current_period_end ? new Date(sub.current_period_end as string).getTime() : null;
  const trialEnd = sub.trial_end ? new Date(sub.trial_end as string).getTime() : null;

  const base = {
    plan: (sub.plan as string) ?? "starter",
    trial_end: (sub.trial_end as string | null) ?? null,
    current_period_end: (sub.current_period_end as string | null) ?? null,
    cancel_at_period_end: Boolean(sub.cancel_at_period_end),
    status: (sub.status as string | null) ?? null,
  };

  switch (sub.status) {
    case "trialing":
      if (trialEnd && trialEnd < now) return { ...base, state: "trial_expired", blocked: true };
      return { ...base, state: "trialing", blocked: false };
    case "active":
      return { ...base, state: "active", blocked: false };
    case "past_due":
      return { ...base, state: "past_due", blocked: true };
    case "unpaid":
      return { ...base, state: "unpaid", blocked: true };
    case "canceled":
      // Résiliation programmée en fin de période : Stripe pousse
      // `cancel_at_period_end = true` + `current_period_end` futur via webhook.
      // On n'accorde le sursis QUE dans ce cas précis : un vieux statut
      // `canceled` avec une période future incohérente (résiliation immédiate,
      // remboursement, désynchronisation) reste bloqué (fail-closed).
      if (periodEnd && periodEnd > now && base.cancel_at_period_end) {
        return { ...base, state: "canceled_grace", blocked: false };
      }
      return { ...base, state: "canceled", blocked: true };

    case "incomplete":
      return { ...base, state: "incomplete", blocked: true };
    case "incomplete_expired":
      return { ...base, state: "incomplete_expired", blocked: true };
    case "paused":
      return { ...base, state: "paused", blocked: true };
    default:
      return { ...base, state: "blocked", blocked: true };
  }
}

/** SUBSCRIPTION_REQUIRED:<state> — the prefix lets the UI detect & redirect. */
export async function assertSubscriptionUsable(companyId: string, userId?: string): Promise<AccessInfo> {
  // Hard block: platform-suspended companies cannot perform write actions.
  const { data: comp } = await supabaseAdmin
    .from("companies")
    .select("suspended_at,support_status,suspension_reason")
    .eq("id", companyId)
    .maybeSingle();
  if (comp && ((comp as any).suspended_at || (comp as any).support_status === "blocked")) {
    await writeAuditLog({
      companyId,
      userId: userId ?? null,
      entityType: "company",
      action: "company.suspended_block",
      metadata: { reason: (comp as any).suspension_reason ?? null },
    });
    throw new Error(`COMPANY_SUSPENDED:${(comp as any).suspension_reason ?? "support"}`);
  }

  const access = await getAccessState(companyId);
  if (access.blocked) {
    await writeAuditLog({
      companyId,
      userId: userId ?? null,
      entityType: "subscription",
      action: "billing.limit_reached",
      metadata: { reason: access.state, plan: access.plan },
    });
    throw new Error(`SUBSCRIPTION_REQUIRED:${access.state}`);
  }
  return access;
}

/**
 * Garde d'écriture centrale : à appeler AVANT toute mutation métier
 * (création ou modification de contenu). Lecture toujours autorisée.
 * Ordre canonique : assertCompanyWriteAccess → assertPlanFeature → quota.
 */
export const assertCompanyWriteAccess = assertSubscriptionUsable;



export async function assertCanCreatePv(companyId: string, userId?: string) {
  await assertSubscriptionUsable(companyId, userId);
  const { data, error } = await supabaseAdmin.rpc("can_create_pv", { _company_id: companyId });
  if (error) throw error;
  if (!data) {
    const planRes = await supabaseAdmin.rpc("get_company_plan", { _company_id: companyId });
    await writeAuditLog({
      companyId,
      userId: userId ?? null,
      entityType: "subscription",
      action: "billing.limit_reached",
      metadata: { reason: "pv_quota", plan: planRes.data ?? "starter" },
    });
    throw new Error(
      `Quota PV mensuel atteint pour le plan ${planRes.data || "starter"}. Passez au plan supérieur pour continuer.`,
    );
  }
}

export async function assertCanAddMember(companyId: string, userId?: string) {
  await assertSubscriptionUsable(companyId, userId);
  const { data, error } = await supabaseAdmin.rpc("can_add_member", { _company_id: companyId });
  if (error) throw error;
  if (!data) {
    const planRes = await supabaseAdmin.rpc("get_company_plan", { _company_id: companyId });
    await writeAuditLog({
      companyId,
      userId: userId ?? null,
      entityType: "subscription",
      action: "billing.limit_reached",
      metadata: { reason: "member_quota", plan: planRes.data ?? "starter" },
    });
    throw new Error(
      `Nombre maximum d'utilisateurs atteint pour le plan ${planRes.data || "starter"}. Mettez à niveau pour inviter plus de membres.`,
    );
  }
}

export async function assertPlanFeature(companyId: string, feature: PlanFeature, userId?: string) {
  await assertSubscriptionUsable(companyId, userId);
  const { data, error } = await supabaseAdmin.rpc("has_plan_feature", {
    _company_id: companyId,
    _feature: feature,
  });
  if (error) throw error;
  if (!data) {
    await writeAuditLog({
      companyId,
      userId: userId ?? null,
      entityType: "subscription",
      action: "billing.limit_reached",
      metadata: { reason: "feature_locked", feature },
    });
    const labels: Record<PlanFeature, string> = {
      remote_sign: "Signature à distance",
      advanced_stats: "Statistiques avancées",
      export_audit: "Export de l'historique d'audit",
      branding: "Branding personnalisé",
      technical_visits: "Visite technique",
    };
    throw new Error(`Fonctionnalité « ${labels[feature]} » non incluse dans votre plan actuel.`);
  }
}

export async function getCompanyPlan(companyId: string): Promise<string> {
  const { data } = await supabaseAdmin.rpc("get_company_plan", { _company_id: companyId });
  return (data as string) || "starter";
}

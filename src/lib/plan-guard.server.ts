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

export type {
  AccessState,
  AccessInfo,
  SubscriptionSnapshot,
  CompanyTrialSnapshot,
} from "./access-state";
import {
  computeAccessState,
  type AccessInfo,
  type SubscriptionSnapshot,
  type CompanyTrialSnapshot,
} from "./access-state";
export { computeAccessState };

/**
 * Computes the authoritative access state for a company (lecture base +
 * décision pure `computeAccessState`).
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
      .select("trial_ends_at")
      .eq("id", companyId)
      .maybeSingle(),
  ]);
  return computeAccessState(sub as SubscriptionSnapshot, company as CompanyTrialSnapshot);
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

/**
 * Invariant commercial : UNE entreprise = UN SEUL essai de 14 jours à vie.
 * La preuve est `companies.trial_started_at`, persistante et verrouillée en
 * base (trigger `companies_lock_trial_started_at`) : elle ne peut jamais
 * revenir à NULL, quel que soit le plan Stripe courant. Fail-closed :
 * entreprise introuvable ⇒ essai considéré consommé.
 */
export async function isTrialEligible(companyId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("companies")
    .select("trial_started_at")
    .eq("id", companyId)
    .maybeSingle();
  if (error || !data) return false;
  return (data as any).trial_started_at == null;
}

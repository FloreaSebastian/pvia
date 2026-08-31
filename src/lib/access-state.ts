/**
 * Décision d'accès abonnement — logique PURE, sans base de données.
 * Doit rester en parité stricte avec le SQL `public.company_has_write_access`.
 */

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

/** Ligne d'abonnement minimale nécessaire au calcul d'accès. */
export type SubscriptionSnapshot = {
  status: string | null;
  plan: string | null;
  current_period_end: string | null;
  trial_end: string | null;
  cancel_at_period_end: boolean | null;
} | null;

/** Fenêtre d'essai portée par l'entreprise (essai unique à vie). */
export type CompanyTrialSnapshot = { trial_ends_at: string | null } | null;

/**
 * Cœur PUR de la décision d'accès (testable sans base).
 * Toute évolution de règle doit rester en parité avec le SQL
 * `public.company_has_write_access`.
 */
export function computeAccessState(
  sub: SubscriptionSnapshot,
  company: CompanyTrialSnapshot,
  nowMs: number = Date.now(),
): AccessInfo {
  if (!sub) {

    // Aucun abonnement Stripe : l'entreprise vit sur son essai gratuit de 14 j
    // porté par `companies.trial_ends_at` (défaut now() + 14 j, backfill effectué).
    // Pas de formule gratuite permanente, et AUCUN fallback dérivé de created_at :
    // une date absente = lecture seule (fail-closed), identique au SQL
    // `company_has_write_access`.
    const trialEndIso = ((company as any)?.trial_ends_at as string | null) ?? null;
    const active = trialEndIso ? new Date(trialEndIso).getTime() > nowMs : false;
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


  const now = nowMs;
  const periodEnd = sub.current_period_end ? new Date(sub.current_period_end as string).getTime() : null;
  const trialEnd = sub.trial_end ? new Date(sub.trial_end as string).getTime() : null;

  const base = {
    plan: (sub.plan as string) ?? "starter",
    trial_end: (sub.trial_end as string | null) ?? null,
    current_period_end: (sub.current_period_end as string | null) ?? null,
    cancel_at_period_end: Boolean(sub.cancel_at_period_end),
    status: (sub.status as string | null) ?? null,
  };

  /** Tolérance de synchro Stripe : un renouvellement normal met quelques
   *  minutes à arriver par webhook. Au-delà de 3 jours, la ligne est
   *  considérée périmée et l'écriture est refusée (anti fail-open). */
  const SYNC_GRACE_MS = 3 * 86_400_000;

  // Invariant commercial : une entreprise = un seul essai à vie. La fenêtre
  // d'essai locale (`companies.trial_ends_at`) est la seule autorité. Si Stripe
  // renvoie `trialing` alors que cette fenêtre est terminée (nouvelle
  // subscription d'essai injectée, réactivation, incohérence de sync), on
  // refuse l'accès gratuit — fail-closed, parité avec `company_has_write_access`.
  const companyTrialEndIso = ((company as any)?.trial_ends_at as string | null) ?? null;
  const companyTrialActive = companyTrialEndIso
    ? new Date(companyTrialEndIso).getTime() > now
    : false;


  switch (sub.status) {
    case "trialing":
      // Fail-closed : `trialing` sans date de fin = donnée non fiable.
      if (!trialEnd || trialEnd < now) return { ...base, state: "trial_expired", blocked: true };
      if (!companyTrialActive) return { ...base, state: "trial_expired", blocked: true };
      return { ...base, state: "trialing", blocked: false };

    case "active": {
      // `active` seul ne suffit pas : si le webhook de renouvellement n'est
      // jamais arrivé, la période payée peut être terminée depuis longtemps.
      // `current_period_end` NULL = donnée non fiable (Stripe fournit toujours
      // cette date pour un abonnement actif) ⇒ fail-closed. La resynchro
      // `/billing?status=success` ou le webhook repeuplent le champ.
      if (periodEnd === null) return { ...base, state: "blocked", blocked: true };
      if (periodEnd < now - SYNC_GRACE_MS) return { ...base, state: "blocked", blocked: true };
      return { ...base, state: "active", blocked: false };
    }


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


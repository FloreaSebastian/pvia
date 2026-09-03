/**
 * Garde anti-doublon d'abonnement — logique PURE (testable sans base ni Stripe).
 *
 * Règle : avant d'ouvrir un Checkout, on inspecte TOUTES les lignes
 * d'abonnement de l'entreprise pour l'environnement courant, pas seulement
 * la plus récente ni celles portant la formule demandée. Un abonnement Stripe
 * existant sur une AUTRE formule doit passer par le portail (changement de
 * formule), sinon l'entreprise se retrouverait avec deux abonnements facturés.
 */

export type CheckoutGuardRow = {
  stripe_customer_id: string | null;
  plan: string | null;
  status: string | null;
  created_at?: string | null;
};

export const CHECKOUT_GUARD_MESSAGES = {
  regularize:
    "Votre abonnement en cours présente un paiement en attente. Utilisez « Gérer mon abonnement » pour le régulariser.",
  samePlan:
    "Vous êtes déjà abonné à ce plan. Utilisez « Gérer mon abonnement » pour modifier la périodicité ou le moyen de paiement.",
  otherPlan:
    "Un abonnement est déjà actif sur une autre formule. Utilisez « Gérer mon abonnement » pour changer de formule, afin d'éviter un double abonnement.",
} as const;

/** Statuts imposant une régularisation par le portail (jamais un 2ᵉ Checkout). */
const REGULARIZE_STATUSES = new Set(["past_due", "unpaid", "incomplete"]);
/** Statuts d'abonnement Stripe réellement en vigueur. */
const LIVE_STATUSES = new Set(["active", "trialing"]);

export type CheckoutGuardDecision = {
  /** Message d'erreur métier si le Checkout doit être refusé. */
  block: string | null;
  /** Customer Stripe à réutiliser (évite les doublons de Customer). */
  customerId: string | null;
};

export function decideCheckoutGuard(
  rows: readonly CheckoutGuardRow[] | null | undefined,
  targetPlan: string,
): CheckoutGuardDecision {
  const all = (rows ?? []).filter(Boolean);

  // Customer réutilisable : n'importe quelle ligne en porte un ; on privilégie
  // la plus récente pour rester aligné sur l'état Stripe courant.
  const byRecent = [...all].sort(
    (a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime(),
  );
  const customerId = byRecent.find((r) => r.stripe_customer_id)?.stripe_customer_id ?? null;

  const status = (r: CheckoutGuardRow) => String(r.status ?? "");

  if (all.some((r) => REGULARIZE_STATUSES.has(status(r)))) {
    return { block: CHECKOUT_GUARD_MESSAGES.regularize, customerId };
  }

  const live = all.filter((r) => LIVE_STATUSES.has(status(r)));
  if (live.some((r) => r.plan === targetPlan)) {
    return { block: CHECKOUT_GUARD_MESSAGES.samePlan, customerId };
  }
  if (live.length > 0) {
    return { block: CHECKOUT_GUARD_MESSAGES.otherPlan, customerId };
  }

  // canceled / incomplete_expired / paused / aucune ligne → Checkout autorisé.
  return { block: null, customerId };
}

/* ------------------------------------------------------------------ *
 * Alignement d'essai — logique PURE.
 *
 * Invariant : un Checkout n'accorde JAMAIS un nouvel essai. Il peut
 * uniquement s'aligner sur la fenêtre d'essai INTERNE encore en cours
 * (`companies.trial_ends_at`). Essai terminé ou absent ⇒ aucun `trial_end`,
 * aucun `trial_period_days` : facturation immédiate.
 * ------------------------------------------------------------------ */

export const STRIPE_MIN_TRIAL_MS = 48 * 3_600_000;

export const TRIAL_TOO_CLOSE_MESSAGE =
  "Votre essai gratuit se termine dans moins de 48 heures : l'activation d'une formule sera possible dès sa fin, sans aucun prélèvement d'ici là.";

export type TrialAlignment =
  | { block: string; trialEnd: null }
  | { block: null; trialEnd: number | null };

export function computeTrialAlignment(
  trialEndsAtIso: string | null | undefined,
  nowMs: number = Date.now(),
): TrialAlignment {
  const ms = trialEndsAtIso ? new Date(trialEndsAtIso).getTime() : null;
  const inProgress = ms !== null && Number.isFinite(ms) && ms > nowMs;
  if (!inProgress) return { block: null, trialEnd: null };
  if (ms! <= nowMs + STRIPE_MIN_TRIAL_MS) return { block: TRIAL_TOO_CLOSE_MESSAGE, trialEnd: null };
  return { block: null, trialEnd: Math.floor(ms! / 1000) };
}

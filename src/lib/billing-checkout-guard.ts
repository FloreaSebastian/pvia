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

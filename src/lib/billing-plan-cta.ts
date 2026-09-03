/**
 * Décision PURE de l'état d'une carte de formule sur /billing.
 *
 * Règle produit : la valeur interne du plan (`get_company_plan`) n'est qu'une
 * formule MÉMORISÉE. Après expiration de l'essai et sans abonnement Stripe
 * réellement valide, elle ne doit jamais rendre la carte non actionnable.
 */

import type { AccessState } from "./access-state";

export type PlanCtaKind = "current" | "regularize" | "activate" | "switch" | "contact";

export type SubscriptionForCta = {
  status: string | null;
  plan: string | null;
} | null;

/** Formule réellement couverte par un abonnement Stripe valide, sinon null. */
export function paidCoveredPlan(
  sub: SubscriptionForCta,
  accessState: AccessState | string | null | undefined,
  fallbackPlan: string,
): string | null {
  if (!sub || !sub.status) return null;
  const accessOpenByStripe = ["active", "trialing", "canceled_grace"].includes(String(accessState ?? ""));
  const stripeValid = ["active", "trialing", "canceled"].includes(sub.status);
  return accessOpenByStripe && stripeValid ? (sub.plan ?? fallbackPlan) : null;
}

/** Abonnement existant en défaut de paiement → portail Stripe, jamais un doublon. */
export function regularizePlan(
  sub: SubscriptionForCta,
  accessState: AccessState | string | null | undefined,
  fallbackPlan: string,
): string | null {
  if (!sub) return null;
  return ["past_due", "unpaid", "incomplete"].includes(String(accessState ?? ""))
    ? (sub.plan ?? fallbackPlan)
    : null;
}

export function planCtaKind(args: {
  cardPlan: string;
  selectedPlan: string;
  coveredPlan: string | null;
  regularize: string | null;
  isCustomPricing: boolean;
}): PlanCtaKind {
  if (args.coveredPlan === args.cardPlan) return "current";
  if (args.regularize === args.cardPlan) return "regularize";
  if (args.isCustomPricing) return "contact";
  return args.cardPlan === args.selectedPlan ? "activate" : "switch";
}

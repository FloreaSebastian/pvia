/**
 * Changement d'offre autonome — décisions PURES (aucun appel réseau).
 *
 * Politique par défaut PVIA :
 *  - Montée de gamme (et mensuel → annuel) : IMMÉDIATE avec prorata. Les
 *    droits ne changent qu'après paiement confirmé (Stripe
 *    `payment_behavior: pending_if_incomplete`).
 *  - Baisse de gamme et annuel → mensuel : PROGRAMMÉE à la fin de la période
 *    payée. Droits actuels conservés jusque-là, programmation annulable.
 *  - Pendant l'essai : rien n'est payé, le changement est immédiat, sans
 *    prélèvement avant la fin de l'essai.
 */
import { CHECKOUT_PRICE_IDS, type CheckoutPriceId } from "./plans";

export type PaidPlan = "starter" | "pro" | "business";
export type Interval = "monthly" | "annual";

export const PLAN_TIER: Record<PaidPlan, number> = { starter: 1, pro: 2, business: 3 };

export function isAllowedPriceId(id: unknown): id is CheckoutPriceId {
  return typeof id === "string" && (CHECKOUT_PRICE_IDS as string[]).includes(id);
}

export function parsePriceId(id: string): { plan: PaidPlan; interval: Interval } | null {
  if (!isAllowedPriceId(id)) return null;
  const [plan, interval] = id.split("_") as [PaidPlan, Interval];
  return { plan, interval };
}

export type ChangeKind =
  | "upgrade" // gamme supérieure (périodicité identique ou mensuel → annuel)
  | "interval_upgrade" // même gamme, mensuel → annuel
  | "downgrade" // gamme inférieure
  | "interval_downgrade"; // annuel → mensuel (gamme identique ou supérieure)

export type ChangeMode = "immediate" | "scheduled";

export type ChangeDecision =
  | { ok: true; kind: ChangeKind; mode: ChangeMode }
  | { ok: false; reason: "same" | "invalid_price" };

export function decideChange(fromPriceId: string, toPriceId: string, opts: { trialing?: boolean } = {}): ChangeDecision {
  const from = parsePriceId(fromPriceId);
  const to = parsePriceId(toPriceId);
  if (!from || !to) return { ok: false, reason: "invalid_price" };
  if (from.plan === to.plan && from.interval === to.interval) return { ok: false, reason: "same" };

  const tierDelta = PLAN_TIER[to.plan] - PLAN_TIER[from.plan];
  let kind: ChangeKind;
  if (tierDelta < 0) kind = "downgrade";
  else if (from.interval === "annual" && to.interval === "monthly") kind = "interval_downgrade";
  else if (tierDelta === 0) kind = "interval_upgrade";
  else kind = "upgrade";

  const scheduled = kind === "downgrade" || kind === "interval_downgrade";
  // Essai : aucune période payée à protéger → application immédiate sans frais.
  const mode: ChangeMode = opts.trialing ? "immediate" : scheduled ? "scheduled" : "immediate";
  return { ok: true, kind, mode };
}

/* ----------------------------- Éligibilité ----------------------------- */

export type SubscriptionStateForChange = {
  status: string | null;
  cancel_at_period_end?: boolean | null;
  stripe_subscription_id?: string | null;
  pending_price_id?: string | null;
};

export const CHANGE_BLOCK_MESSAGES = {
  none: "Aucun abonnement actif : choisissez d'abord une formule.",
  regularize:
    "Un paiement est en attente sur votre abonnement. Régularisez-le avant de changer de formule.",
  canceling:
    "Votre abonnement est résilié en fin de période. Réactivez-le depuis « Gérer l'abonnement » avant de changer de formule.",
  pending:
    "Un changement de formule attend la confirmation de son paiement. Finalisez ou laissez-le expirer avant d'en demander un autre.",
  same: "Vous êtes déjà sur cette formule et cette périodicité.",
  invalid: "Cette offre n'est pas disponible.",
} as const;

export function changeBlockReason(sub: SubscriptionStateForChange | null): string | null {
  if (!sub || !sub.stripe_subscription_id || !sub.status) return CHANGE_BLOCK_MESSAGES.none;
  if (["past_due", "unpaid", "incomplete"].includes(sub.status)) return CHANGE_BLOCK_MESSAGES.regularize;
  if (!["active", "trialing"].includes(sub.status)) return CHANGE_BLOCK_MESSAGES.none;
  if (sub.cancel_at_period_end) return CHANGE_BLOCK_MESSAGES.canceling;
  if (sub.pending_price_id) return CHANGE_BLOCK_MESSAGES.pending;
  return null;
}

/* ------------------------------ Dépassements ------------------------------ */

export type PlanLimitsLike = {
  plan: string;
  display_name?: string | null;
  max_members: number | null;
  max_pv_per_month: number | null;
  can_remote_sign?: boolean;
  can_advanced_stats?: boolean;
  can_export_audit?: boolean;
  can_branding?: boolean;
  can_technical_visits?: boolean;
};

export type Overage = { code: string; message: string; blocking: false };

const FEATURE_LABELS: [keyof PlanLimitsLike, string][] = [
  ["can_remote_sign", "Signature à distance"],
  ["can_advanced_stats", "Statistiques avancées"],
  ["can_export_audit", "Export de l'historique d'audit"],
  ["can_branding", "Branding personnalisé"],
  ["can_technical_visits", "Visites techniques"],
];

/**
 * Dépassements après changement. JAMAIS bloquants ni destructifs : aucune
 * donnée n'est supprimée ; on informe et on demande une confirmation explicite.
 */
export function computeOverages(
  current: PlanLimitsLike | null,
  target: PlanLimitsLike,
  usage: { seats: number; pv_this_period: number },
): Overage[] {
  const out: Overage[] = [];
  if (target.max_members != null && usage.seats > target.max_members) {
    out.push({
      code: "seats",
      blocking: false,
      message: `Votre équipe compte ${usage.seats} utilisateurs (invitations incluses) pour ${target.max_members} inclus. Personne n'est supprimé, mais aucun nouvel utilisateur ne pourra être ajouté tant que l'équipe dépasse la limite.`,
    });
  }
  if (target.max_pv_per_month != null && usage.pv_this_period > target.max_pv_per_month) {
    out.push({
      code: "pv",
      blocking: false,
      message: `${usage.pv_this_period} PV créés ce mois-ci pour ${target.max_pv_per_month} inclus par mois. Les PV existants sont conservés ; la création de nouveaux PV sera limitée jusqu'au mois suivant.`,
    });
  }
  for (const [key, label] of FEATURE_LABELS) {
    if (current?.[key] && !target[key]) {
      out.push({
        code: `feature:${String(key)}`,
        blocking: false,
        message: `${label} : non incluse. Les éléments déjà créés restent consultables.`,
      });
    }
  }
  return out;
}

/* ------------------------------ Aperçu Stripe ------------------------------ */

export type PreviewAmounts = {
  currency: string;
  /** Montants en centimes. Négatif = crédit en faveur du client. */
  ht: number;
  tva: number;
  ttc: number;
  credit: number;
};

/** Extrait HT / TVA / TTC d'une facture d'aperçu Stripe (API dahlia). */
export function amountsFromInvoice(inv: any): PreviewAmounts {
  const ttc = Number(inv?.total ?? 0);
  const ht = Number(inv?.total_excluding_tax ?? inv?.subtotal_excluding_tax ?? inv?.subtotal ?? ttc);
  const taxes = Array.isArray(inv?.total_taxes)
    ? inv.total_taxes.reduce((s: number, t: any) => s + Number(t?.amount ?? 0), 0)
    : ttc - ht;
  return {
    currency: String(inv?.currency ?? "eur"),
    ht,
    tva: taxes,
    ttc,
    credit: ttc < 0 ? -ttc : 0,
  };
}

/* ------------------------- Machine d'état demandes ------------------------- */

export type ChangeStatus =
  | "previewed"
  | "processing"
  | "applied"
  | "scheduled"
  | "payment_pending"
  | "payment_failed"
  | "canceled"
  | "expired"
  | "superseded"
  | "failed";

export const TERMINAL_STATUSES: ChangeStatus[] = ["applied", "canceled", "expired", "superseded", "failed"];

export type ChangeRequestLike = {
  status: ChangeStatus;
  mode: ChangeMode;
  to_price_id: string;
  stripe_schedule_id?: string | null;
};

export type StripeSubSnapshot = {
  price_id: string | null;
  pending_price_id: string | null;
  schedule_id: string | null;
  scheduled_price_id: string | null;
  status: string;
};

/**
 * Réconciliation d'une demande avec l'état Stripe faisant autorité.
 * Indépendante de l'ordre d'arrivée des webhooks : seule la photo courante
 * (relue chez Stripe) compte. Renvoie le nouveau statut, ou null si inchangé.
 */
export function reconcileRequest(req: ChangeRequestLike, sub: StripeSubSnapshot): ChangeStatus | null {
  if (TERMINAL_STATUSES.includes(req.status)) return null;
  if (req.status === "previewed" || req.status === "processing") return null;

  if (req.mode === "immediate") {
    if (sub.price_id === req.to_price_id && !sub.pending_price_id) return "applied";
    if (!sub.pending_price_id && sub.price_id !== req.to_price_id) {
      // Mise à jour en attente abandonnée par Stripe (expiration ~23 h) ou remplacée.
      return "expired";
    }
    return null; // toujours en attente de paiement
  }

  // Programmé
  if (sub.price_id === req.to_price_id) return "applied";
  if (!sub.schedule_id || (req.stripe_schedule_id && sub.schedule_id !== req.stripe_schedule_id)) return "canceled";
  if (sub.scheduled_price_id && sub.scheduled_price_id !== req.to_price_id) return "superseded";
  return null;
}

/** Diagnostic d'un paiement de changement non abouti. */
export function classifyPaymentIntentStatus(status: string | null | undefined): "sca_required" | "payment_failed" | "processing" | null {
  if (!status) return null;
  if (status === "requires_action" || status === "requires_confirmation") return "sca_required";
  if (status === "requires_payment_method" || status === "canceled") return "payment_failed";
  if (status === "processing") return "processing";
  return null;
}

export const CHANGE_KIND_LABELS: Record<ChangeKind, string> = {
  upgrade: "Montée de gamme",
  interval_upgrade: "Passage à la facturation annuelle",
  downgrade: "Baisse de gamme",
  interval_downgrade: "Passage à la facturation mensuelle",
};

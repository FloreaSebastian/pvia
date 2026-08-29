/**
 * Source de vérité côté client pour la grille tarifaire PVIA.
 *
 * Les valeurs faisant autorité (quotas, features, prix) vivent dans la table
 * `plan_limits` et sont renvoyées par `getCompanyBilling`. Ce module ne sert
 * qu'à l'affichage public (landing /tarifs) et au mapping plan ↔ price id.
 */

export type PlanKey = "starter" | "pro" | "business" | "enterprise";
export type BillingInterval = "monthly" | "annual";

export const PLAN_ORDER: PlanKey[] = ["starter", "pro", "business", "enterprise"];

export const PLAN_LABELS: Record<PlanKey, string> = {
  starter: "Essentiel",
  pro: "Pro",
  business: "Business",
  enterprise: "Entreprise",
};

/** Lookup keys Stripe (identiques en test et en production). */
export const PLAN_PRICE_IDS = {
  starter: { monthly: "starter_monthly", annual: "starter_annual" },
  pro: { monthly: "pro_monthly", annual: "pro_annual" },
  business: { monthly: "business_monthly", annual: "business_annual" },
} as const;

export type CheckoutPriceId =
  | "starter_monthly"
  | "starter_annual"
  | "pro_monthly"
  | "pro_annual"
  | "business_monthly"
  | "business_annual";

export const CHECKOUT_PRICE_IDS: CheckoutPriceId[] = [
  "starter_monthly",
  "starter_annual",
  "pro_monthly",
  "pro_annual",
  "business_monthly",
  "business_annual",
];

/** Plans sans checkout automatique (devis commercial). */
export const CUSTOM_PRICING_PLANS: PlanKey[] = ["enterprise"];

export const TRIAL_DAYS = 14;

export const CONTACT_SALES_EMAIL = "contact@pvia.fr";

/** Grille publique — miroir de `plan_limits` pour la landing (sans appel réseau). */
export const PUBLIC_PLANS: {
  key: PlanKey;
  name: string;
  tagline: string;
  monthly: number | null;
  annual: number | null;
  maxMembers: number | null;
  recommended?: boolean;
  features: string[];
  /** Fonctionnalités explicitement non incluses (affichées barrées). */
  notIncluded?: string[];
  cta: string;
}[] = [
  {
    key: "starter",
    name: "Essentiel",
    tagline: "Pour les indépendants et artisans.",
    monthly: 19,
    annual: 190,
    maxMembers: 1,
    features: [
      "1 utilisateur",
      "10 PV par mois",
      "Signature sur site illimitée",
      "Photos, réserves et export PDF",
      "Support par email",
    ],
    notIncluded: ["Visites techniques (à partir du plan Pro)"],
    cta: "Essayer gratuitement",
  },
  {
    key: "pro",
    name: "Pro",
    tagline: "Pour les petites équipes et entreprises du bâtiment.",
    monthly: 59,
    annual: 590,
    maxMembers: 5,
    recommended: true,
    features: [
      "Jusqu'à 5 utilisateurs",
      "100 PV par mois",
      "Signature à distance (email + OTP)",
      "Statistiques avancées",
      "Export de l'historique d'audit",
      "Visites techniques PV, PAC air/air et air/eau",
      "Support prioritaire",
    ],
    cta: "Essayer gratuitement",
  },
  {
    key: "business",
    name: "Business",
    tagline: "Pour les entreprises avec plusieurs équipes et conducteurs de travaux.",
    monthly: 149,
    annual: 1490,
    maxMembers: 20,
    features: [
      "Jusqu'à 20 utilisateurs",
      "PV illimités",
      "Signature à distance (email + OTP)",
      "Statistiques avancées",
      "Branding personnalisé (logo, couleurs)",
      "Visites techniques PV, PAC air/air et air/eau",
      "Export de l'historique d'audit",
    ],
    cta: "Essayer gratuitement",
  },
  {
    key: "enterprise",
    name: "Entreprise",
    tagline: "Pour les organisations ayant des besoins avancés et un déploiement personnalisé.",
    monthly: null,
    annual: null,
    maxMembers: null,
    features: [
      "Utilisateurs illimités",
      "PV illimités",
      "Visites techniques PV, PAC air/air et air/eau",
      "Multi-sociétés et gestion fine des rôles",
      "API, webhooks et intégrations",
      "Accompagnement dédié et SLA",
    ],
    cta: "Nous contacter",
  },
];

const eur = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

/** Formatte un montant HT en euros (ex. « 59 € »). */
export function formatEur(amount: number): string {
  return eur.format(amount);
}

/** Économie annuelle en % par rapport à 12 mensualités. */
export function annualSavingPercent(monthly: number | null, annual: number | null): number | null {
  if (!monthly || !annual) return null;
  const full = monthly * 12;
  if (full <= annual) return null;
  return Math.round(((full - annual) / full) * 100);
}

/* ------------------------------------------------------------------ *
 * État d'abonnement — libellés lisibles (jamais « free » brut en UI)  *
 * ------------------------------------------------------------------ */

export type AccessStateKey =
  | "free" | "trialing" | "active" | "canceled_grace" | "past_due" | "unpaid"
  | "trial_expired" | "canceled" | "incomplete" | "incomplete_expired"
  | "paused" | "blocked";

export const ACCESS_STATE_LABELS: Record<AccessStateKey, string> = {
  free: "Accès restreint",
  trialing: "Essai gratuit",
  active: "Abonnement actif",
  canceled_grace: "Résiliation programmée — accès jusqu'à la fin de période",
  past_due: "Abonnement à régulariser",
  unpaid: "Abonnement à régulariser",
  trial_expired: "Accès restreint — essai terminé",
  canceled: "Accès restreint — abonnement résilié",
  incomplete: "Abonnement à régulariser",
  incomplete_expired: "Abonnement à régulariser",
  paused: "Accès restreint — abonnement en pause",
  blocked: "Accès restreint",
};

/** Phrase d'explication affichée sous le libellé d'état (jamais « gratuit »). */
export const ACCESS_STATE_HELP: Record<AccessStateKey, string> = {
  free: "Choisissez une formule pour activer la création et la modification. Vos données restent accessibles.",
  trialing: "Activez une formule avant la fin de l'essai pour continuer sans interruption.",
  active: "Votre abonnement est actif.",
  canceled_grace: "Votre abonnement est résilié à la fin de la période en cours ; l'accès complet est maintenu jusqu'à cette date.",
  past_due: "Régularisez votre paiement pour réactiver la création et la modification. Vos données restent accessibles.",
  unpaid: "Régularisez votre paiement pour réactiver la création et la modification. Vos données restent accessibles.",
  trial_expired: "Choisissez une formule pour réactiver la création et la modification. Vos données restent accessibles.",
  canceled: "Choisissez une formule pour réactiver la création et la modification. Vos données restent accessibles.",
  incomplete: "Finalisez votre paiement pour réactiver la création et la modification. Vos données restent accessibles.",
  incomplete_expired: "Reprenez un abonnement pour réactiver la création et la modification. Vos données restent accessibles.",
  paused: "Reprenez votre abonnement pour réactiver la création et la modification. Vos données restent accessibles.",
  blocked: "Choisissez une formule pour réactiver la création et la modification. Vos données restent accessibles.",
};

export function accessStateLabel(state?: string | null): string {
  if (!state) return ACCESS_STATE_LABELS.free;
  return ACCESS_STATE_LABELS[state as AccessStateKey] ?? "Accès restreint";
}

export function accessStateHelp(state?: string | null): string {
  if (!state) return ACCESS_STATE_HELP.free;
  return ACCESS_STATE_HELP[state as AccessStateKey] ?? ACCESS_STATE_HELP.blocked;
}


/** Économie annuelle en euros (12 mensualités − prix annuel). */
export function annualSavingEur(monthly?: number | null, annual?: number | null): number | null {
  if (!monthly || !annual) return null;
  const saving = monthly * 12 - annual;
  return saving > 0 ? saving : null;
}

/** Jours restants avant une date ISO (0 minimum). */
export function daysUntil(iso?: string | null): number | null {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / 86_400_000));
}

export function formatFrDate(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

/* ------------------------------------------------------------------ *
 * Matrice de comparaison — dérivée UNIQUEMENT des colonnes réelles     *
 * de `plan_limits` (source de vérité serveur). Aucune fonctionnalité   *
 * inventée : chaque ligne pointe soit vers un flag existant, soit vers *
 * une capacité disponible sur toutes les formules.                     *
 * ------------------------------------------------------------------ */

export type PlanLimitsRow = {
  plan: string;
  display_name: string;
  tagline?: string | null;
  monthly_price_eur: number | null;
  annual_price_eur: number | null;
  max_members: number | null;
  max_pv_per_month: number | null;
  can_remote_sign: boolean;
  can_advanced_stats: boolean;
  can_export_audit: boolean;
  can_branding: boolean;
  can_technical_visits: boolean;
  is_custom_pricing?: boolean;
  recommended?: boolean;
  sort_order?: number;
  stripe_price_monthly?: string | null;
  stripe_price_annual?: string | null;
};

/** `true` = inclus, `false` = non inclus, string = limite chiffrée. */
export type CellValue = boolean | string;

export type ComparisonRow = { label: string; value: (p: PlanLimitsRow) => CellValue };
export type ComparisonSection = { title: string; rows: ComparisonRow[] };

const seats = (p: PlanLimitsRow) =>
  p.is_custom_pricing || p.max_members == null
    ? "Illimité"
    : `${p.max_members} utilisateur${p.max_members > 1 ? "s" : ""}`;

export const COMPARISON: ComparisonSection[] = [
  {
    title: "Chantier",
    rows: [
      { label: "Gestion des chantiers", value: () => true },
      { label: "Clients", value: () => true },
      { label: "Calendrier chantier", value: () => true },
      { label: "Affectation des techniciens", value: () => true },
      { label: "Multi-équipes (utilisateurs)", value: seats },
    ],
  },
  {
    title: "Visite technique",
    rows: [
      { label: "Visites techniques", value: (p) => p.can_technical_visits },
      { label: "Photovoltaïque", value: (p) => p.can_technical_visits },
      { label: "PAC air/air", value: (p) => p.can_technical_visits },
      { label: "PAC air/eau", value: (p) => p.can_technical_visits },
      { label: "Photos de visite", value: (p) => p.can_technical_visits },
      { label: "Création automatique du chantier", value: (p) => p.can_technical_visits },
    ],
  },
  {
    title: "Réception",
    rows: [
      {
        label: "PV de réception",
        value: (p) => (p.max_pv_per_month == null ? "Illimités" : `${p.max_pv_per_month} / mois`),
      },
      { label: "Photos de réserve", value: () => true },
      { label: "Réserves", value: () => true },
      { label: "Signature sur site", value: () => true },
      { label: "Signature à distance", value: (p) => p.can_remote_sign },
      { label: "Génération PDF", value: () => true },
      { label: "Levées de réserves", value: () => true },
    ],
  },
  {
    title: "Client",
    rows: [
      { label: "Envoi des documents", value: () => true },
      { label: "Espace client", value: () => true },
      { label: "Signature client à distance", value: (p) => p.can_remote_sign },
      { label: "Validation / refus des levées", value: () => true },
      { label: "Historique client", value: () => true },
    ],
  },
  {
    title: "Pilotage",
    rows: [
      { label: "Statistiques", value: (p) => (p.can_advanced_stats ? "Avancées" : "De base") },
      { label: "Historique des PV", value: () => true },
      { label: "Journal d'audit", value: () => true },
      { label: "Export de l'audit", value: (p) => p.can_export_audit },
      { label: "Notifications e-mail & push", value: () => true },
      { label: "Branding personnalisé", value: (p) => p.can_branding },
    ],
  },
];

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

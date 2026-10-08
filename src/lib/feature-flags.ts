/**
 * Interrupteurs centraux des modules applicatifs.
 *
 * Un module désactivé reste intégralement présent (code, tables, données) :
 * il est seulement masqué dans la navigation, ses routes directes redirigent
 * en douceur et ses fonctions serveur refusent l'accès. Pour le réactiver,
 * passer la valeur à `true` — aucune migration n'est nécessaire.
 */
export const FEATURE_FLAGS: Readonly<Record<"studies", boolean>> = {
  /** « Cahiers des charges » (pré-études) + Solar Studio rattaché — en développement. */
  studies: false,
};

export type FeatureFlag = keyof typeof FEATURE_FLAGS;

const testOverrides: Partial<Record<FeatureFlag, boolean>> = {};

export function isFeatureEnabled(flag: FeatureFlag): boolean {
  const o = testOverrides[flag];
  if (o !== undefined) return o === true;
  return FEATURE_FLAGS[flag] === true;
}

/** Tests uniquement : force un flag (undefined = valeur réelle). Refusé hors NODE_ENV=test. */
export function setFeatureFlagForTests(flag: FeatureFlag, value: boolean | undefined): void {
  if (typeof process === "undefined" || process.env?.["NODE_ENV"] !== "test") {
    throw new Error("setFeatureFlagForTests est réservé aux tests.");
  }
  if (value === undefined) delete testOverrides[flag];
  else testOverrides[flag] = value;
}

/** Message utilisateur unique pour un module masqué. */
export const MODULE_UNAVAILABLE_MESSAGE =
  "Ce module est en cours de développement et n'est pas encore disponible.";

/** Lève une erreur compréhensible si le module est désactivé (gardes serveur). */
export function assertFeatureEnabled(flag: FeatureFlag): void {
  if (!isFeatureEnabled(flag)) throw new Error(MODULE_UNAVAILABLE_MESSAGE);
}

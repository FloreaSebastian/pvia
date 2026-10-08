/**
 * Interrupteurs centraux des modules applicatifs.
 *
 * Un module désactivé reste intégralement présent (code, tables, données) :
 * il est seulement masqué dans la navigation, ses routes directes redirigent
 * en douceur et ses fonctions serveur refusent l'accès. Pour le réactiver,
 * passer la valeur à `true` — aucune migration n'est nécessaire.
 */
export const FEATURE_FLAGS = {
  /** « Cahiers des charges » (pré-études) + Solar Studio rattaché — en développement. */
  studies: false,
} as const;

export type FeatureFlag = keyof typeof FEATURE_FLAGS;

export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return FEATURE_FLAGS[flag] === true;
}

/** Message utilisateur unique pour un module masqué. */
export const MODULE_UNAVAILABLE_MESSAGE = "Ce module est en cours de développement et n'est pas encore disponible.";

/** Lève une erreur compréhensible si le module est désactivé (gardes serveur). */
export function assertFeatureEnabled(flag: FeatureFlag): void {
  if (!isFeatureEnabled(flag)) throw new Error(MODULE_UNAVAILABLE_MESSAGE);
}

/**
 * Garde de route : redirige vers une page existante et toujours accessible
 * (jamais vers une route elle-même masquée → aucune boucle possible).
 */
export function studiesRouteGuard(fallback: "/visites-techniques" | "/client/dashboard" = "/visites-techniques") {
  return fallback;
}

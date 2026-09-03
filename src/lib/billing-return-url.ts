/**
 * Normalisation des URLs de retour Stripe (Checkout et portail).
 *
 * Le navigateur transmet `returnUrl` (`${window.location.origin}/billing`).
 * Une URL arbitraire ne doit JAMAIS être renvoyée à Stripe : elle deviendrait
 * une redirection ouverte signée par une page de paiement (phishing crédible
 * juste après saisie de carte). On n'accepte donc que des origines de
 * confiance, et on force le chemin `/billing`.
 *
 * Logique PURE (testable sans réseau ni base).
 */

/** Origines autorisées : domaine canonique, domaines PVIA, previews, local. */
export function isTrustedBillingOrigin(origin: string, canonical: string): boolean {
  return (
    origin === canonical ||
    /^https:\/\/([a-z0-9-]+\.)*pvia\.fr$/i.test(origin) ||
    /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.lovable\.app$/i.test(origin) ||
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)
  );
}

/**
 * Retourne toujours une URL absolue `<origine de confiance>/billing`.
 * Toute origine inconnue retombe sur le domaine canonique.
 */
export function resolveBillingReturnUrl(requested: string | undefined | null, canonical: string): string {
  let origin = canonical;
  if (requested) {
    try {
      const u = new URL(requested);
      if (isTrustedBillingOrigin(u.origin, canonical)) origin = u.origin;
    } catch {
      /* URL invalide → canonique */
    }
  }
  return `${origin}/billing`;
}

/**
 * URL publique de l'application, normalisée.
 *
 * `PUBLIC_APP_URL` est une variable d'environnement saisie manuellement :
 * elle peut arriver sans schéma (`pvia.fr`) ou avec un slash final. Toute
 * URL construite pour un email (signature, invitation, PV signé, code de
 * connexion) DOIT être absolue, sinon les liens sont inexploitables.
 *
 * Règles :
 *  - schéma absent  → `https://` ajouté
 *  - `http://` conservé uniquement pour localhost / 127.x (dev)
 *  - slash final supprimé
 *  - valeur vide/invalide → repli `https://pvia.fr`
 */
const FALLBACK = "https://pvia.fr";

export function normalizeAppUrl(raw: string | undefined | null): string {
  const value = (raw ?? "").trim().replace(/\/+$/, "");
  if (!value) return FALLBACK;

  const isLocal = /^(https?:\/\/)?(localhost|127\.)/i.test(value);
  if (/^https?:\/\//i.test(value)) {
    if (/^http:\/\//i.test(value) && !isLocal) {
      return value.replace(/^http:\/\//i, "https://");
    }
    return value;
  }
  return `${isLocal ? "http://" : "https://"}${value}`;
}

/** URL publique absolue, sans slash final. */
export function getPublicAppUrl(): string {
  return normalizeAppUrl(process.env.PUBLIC_APP_URL);
}

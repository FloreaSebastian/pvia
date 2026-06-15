/**
 * Helpers for remote-signature tokens.
 *
 * Security rationale
 * ──────────────────
 * The raw token is delivered to the recipient ONLY via the signed email link.
 * Only its SHA-256 hash is persisted in `pv.sign_token_hash`. A database
 * compromise therefore does not let an attacker reconstruct valid signing
 * links.
 *
 * Web Crypto (`crypto.subtle`) is available in the Cloudflare Worker runtime
 * used by TanStack Start server functions.
 */

/** Generate a 256-bit URL-safe-ish token (64 hex chars). */
export function generateSignToken(): string {
  const a = crypto.randomUUID().replace(/-/g, "");
  const b = crypto.randomUUID().replace(/-/g, "");
  return a + b;
}

/** SHA-256 hex of an arbitrary string. */
export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  const bytes = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

/** Default consent wording archived alongside the signature (eIDAS SES evidence). */
export const SIGN_CONSENT_TEXT_V1 =
  "Je confirme avoir pris connaissance de l'intégralité du procès-verbal et des éventuelles réserves. Je signe ce document au moyen d'une signature électronique simple au sens de l'article 3.10 du règlement eIDAS n°910/2014. Mon adresse IP, mon navigateur, l'horodatage et le contenu signé sont conservés à titre de preuve. Cette signature ne constitue pas une signature électronique qualifiée. En cas d'usurpation, je peux contester cette signature auprès de l'entreprise émettrice.";

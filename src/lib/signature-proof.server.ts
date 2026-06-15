/**
 * Helpers for the "PREUVE DE SIGNATURE ELECTRONIQUE" PDF block (eIDAS SES).
 * Used by pdf.server.ts (PV) and reserve-lift.server.ts (LR).
 */

/** Hex SHA-256 of raw bytes (Web Crypto). */
export async function sha256OfBytes(bytes: Uint8Array): Promise<string> {
  const view: ArrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const hash = await crypto.subtle.digest("SHA-256", view);
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Truncate + sanitize a UA string for proof display (one line). */
export function shortUA(ua: string | null | undefined, max = 90): string {
  if (!ua) return "-";
  const cleaned = ua.replace(/\s+/g, " ").trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

/** Truncate hex hash for display (keeps full prefix + suffix). */
export function formatHash(hex: string | null | undefined): string {
  if (!hex) return "-";
  if (hex.length <= 64) return hex;
  return hex;
}

export const EIDAS_MENTIONS = [
  "Signature electronique simple (SES) au sens de l'article 3.10 du reglement eIDAS (UE) 910/2014.",
  "Cette signature ne constitue pas une signature electronique qualifiee.",
  "Les donnees de preuve (email verifie, date/heure, IP, navigateur, consentement) sont conservees conformement a la politique de conservation de PVIA.",
];

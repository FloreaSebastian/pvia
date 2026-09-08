/**
 * Vérification du type binaire réel d'un fichier (magic bytes).
 * Ne jamais faire confiance au MIME déclaré par le navigateur.
 * Fichier pur (client-safe), utilisé côté serveur.
 */
export type AdminDocMime = "application/pdf" | "image/jpeg" | "image/png";

const PDF = [0x25, 0x50, 0x44, 0x46]; // %PDF
const JPG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, sig: number[]): boolean {
  if (bytes.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (bytes[i] !== sig[i]) return false;
  return true;
}

/** Renvoie le vrai MIME d'un PDF/JPEG/PNG, sinon null. */
export function sniffDocumentMime(bytes: Uint8Array): AdminDocMime | null {
  if (startsWith(bytes, PDF)) return "application/pdf";
  if (startsWith(bytes, JPG)) return "image/jpeg";
  if (startsWith(bytes, PNG)) return "image/png";
  return null;
}

export function extensionForMime(mime: AdminDocMime): "pdf" | "jpg" | "png" {
  return mime === "application/pdf" ? "pdf" : mime === "image/jpeg" ? "jpg" : "png";
}

/** Décode un base64 (sans préfixe data:) en octets, avec plafond de taille. */
export function decodeBase64(b64: string, maxBytes: number): Uint8Array {
  const clean = b64.includes(",") ? b64.slice(b64.indexOf(",") + 1) : b64;
  const approx = Math.floor((clean.length * 3) / 4);
  if (approx > maxBytes) throw new Error(`Fichier trop volumineux (max ${Math.round(maxBytes / 1024 / 1024)} Mo).`);
  const bin = atob(clean);
  if (bin.length > maxBytes) throw new Error(`Fichier trop volumineux (max ${Math.round(maxBytes / 1024 / 1024)} Mo).`);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

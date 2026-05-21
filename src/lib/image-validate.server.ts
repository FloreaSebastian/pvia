/**
 * Vérifie la signature binaire (magic bytes) d'une image plutôt que de
 * faire confiance au content-type déclaré. Empêche un attaquant d'uploader
 * un fichier exécutable avec un faux header `data:image/...`.
 */
const SIGS: { mime: "image/png" | "image/jpeg" | "image/webp"; bytes: number[] | (number | null)[] }[] = [
  { mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  // RIFF....WEBP
  { mime: "image/webp", bytes: [0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50] },
];

export function sniffImageMime(bytes: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | null {
  for (const s of SIGS) {
    if (bytes.length < s.bytes.length) continue;
    let ok = true;
    for (let i = 0; i < s.bytes.length; i++) {
      const expected = s.bytes[i];
      if (expected !== null && bytes[i] !== expected) {
        ok = false;
        break;
      }
    }
    if (ok) return s.mime;
  }
  return null;
}

/** Décode un data:image/...;base64,... et vérifie le vrai MIME. Renvoie bytes + mime sniffé. */
export function decodeAndValidateImage(
  dataUrl: string,
  opts: { maxBytes: number; allowed?: Array<"image/png" | "image/jpeg" | "image/webp"> }
): { bytes: Uint8Array; mime: "image/png" | "image/jpeg" | "image/webp"; ext: "png" | "jpg" | "webp" } {
  const allowed = opts.allowed ?? ["image/png", "image/jpeg", "image/webp"];
  const m = /^data:image\/(?:png|jpe?g|webp);base64,(.+)$/i.exec(dataUrl);
  if (!m) throw new Error("Image invalide (format data URL).");
  const b64 = m[1];
  // Approx size check before decoding
  const approxBytes = Math.floor((b64.length * 3) / 4);
  if (approxBytes > opts.maxBytes) throw new Error(`Image trop volumineuse (max ${Math.round(opts.maxBytes / 1024 / 1024)} Mo).`);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  if (bytes.length > opts.maxBytes) throw new Error("Image trop volumineuse.");
  const sniffed = sniffImageMime(bytes);
  if (!sniffed) throw new Error("Image invalide (signature binaire non reconnue).");
  if (!allowed.includes(sniffed)) throw new Error(`Format ${sniffed} non autorisé.`);
  const ext = sniffed === "image/jpeg" ? "jpg" : sniffed === "image/png" ? "png" : "webp";
  return { bytes, mime: sniffed, ext };
}

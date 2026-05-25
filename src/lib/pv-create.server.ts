/**
 * Helpers for the createPv server function (split into a .server.ts to keep
 * the .functions.ts handler self-contained, per tss-serverfn-split rules).
 */

export const PHOTO_MAX_BYTES = 4 * 1024 * 1024;        // 4 MB raw per photo
export const PHOTO_MAX_COUNT = 20;
export const SIG_MAX_BYTES = 256 * 1024;               // 256 KB per signature PNG

export const PHOTO_ALLOWED_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);

export function sniffImageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 &&
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 &&
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}

/** Decodes a base64 string (no data: prefix). */
export function decodeBase64(input: string): Uint8Array {
  return new Uint8Array(Buffer.from(input, "base64"));
}

/** Strip an optional "data:image/png;base64," prefix and decode. */
export function decodeDataUrlOrBase64(input: string): { bytes: Uint8Array; mime: string | null } {
  const m = /^data:([^;,]+);base64,(.*)$/i.exec(input);
  if (m) {
    return { bytes: decodeBase64(m[2]), mime: m[1].toLowerCase() };
  }
  return { bytes: decodeBase64(input), mime: null };
}

export function normMime(mime: string): string {
  return mime === "image/jpg" ? "image/jpeg" : mime;
}

export function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "file";
}

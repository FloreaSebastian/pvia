/**
 * Convert a File to a plain base64 string (no data: prefix).
 * Used by client-side uploaders that hand the file to a server function.
 */
export async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any);
  }
  return btoa(binary);
}

export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const LOGO_ALLOWED_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/svg+xml",
]);

export function validateLogoFile(file: File): string | null {
  if (!LOGO_ALLOWED_MIMES.has(file.type)) {
    return "Format non supporté (PNG, JPEG, WebP ou SVG).";
  }
  if (file.size > LOGO_MAX_BYTES) {
    return "Logo trop volumineux (max 2 Mo).";
  }
  return null;
}

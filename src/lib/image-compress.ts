/**
 * Client-side image compression for reserve photos.
 * Resizes to fit within maxWidth/maxHeight and re-encodes as JPEG.
 * Skips compression if the file is already small enough and within bounds.
 */
export const PHOTO_BASE64_MAX = 6_000_000;
export const PHOTO_TARGET_BYTES = 1_500_000;

export type CompressOptions = {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  maxBytes?: number;
};

export type CompressResult = { file: File; compressed: boolean };

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

export async function compressImageFile(
  file: File,
  opts: CompressOptions = {},
): Promise<CompressResult> {
  const maxWidth = opts.maxWidth ?? 1600;
  const maxHeight = opts.maxHeight ?? 1600;
  const quality = opts.quality ?? 0.8;
  const maxBytes = opts.maxBytes ?? PHOTO_TARGET_BYTES;

  if (typeof document === "undefined") return { file, compressed: false };
  if (!file.type.startsWith("image/")) return { file, compressed: false };

  let img: HTMLImageElement;
  try {
    img = await loadImage(file);
  } catch {
    return { file, compressed: false };
  }

  const needsResize = img.width > maxWidth || img.height > maxHeight;
  const acceptableType = file.type === "image/jpeg" || file.type === "image/webp";
  if (!needsResize && acceptableType && file.size <= maxBytes) {
    return { file, compressed: false };
  }

  const ratio = Math.min(maxWidth / img.width, maxHeight / img.height, 1);
  const w = Math.max(1, Math.round(img.width * ratio));
  const h = Math.max(1, Math.round(img.height * ratio));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { file, compressed: false };
  ctx.drawImage(img, 0, 0, w, h);

  let currentQuality = quality;
  let blob: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/jpeg", currentQuality));
  // If still too big, retry once at lower quality.
  if (blob && blob.size > maxBytes && currentQuality > 0.5) {
    currentQuality = 0.6;
    blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", currentQuality));
  }
  if (!blob) return { file, compressed: false };

  // If compression made it bigger (already optimised), keep original.
  if (blob.size >= file.size && !needsResize) {
    return { file, compressed: false };
  }

  const baseName = file.name.replace(/\.[^.]+$/, "") || "photo";
  const newFile = new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });
  return { file: newFile, compressed: true };
}

/** Approx max raw bytes that yields a base64 string under PHOTO_BASE64_MAX. */
export const PHOTO_RAW_MAX_BYTES = Math.floor((PHOTO_BASE64_MAX / 4) * 3);

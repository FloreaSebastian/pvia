/**
 * Shared GPS + EXIF helpers for reserve photos.
 * Extracted so both the popup workflow (ReserveLiftWorkflowDialog)
 * and the legacy /pv/:id/levee-reserves page share the same logic.
 */
import exifr from "exifr";

export type PhotoEntry = {
  file: File;
  previewUrl: string;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  takenAt: string;
  deviceInfo: string;
  exifMetadata: Record<string, unknown> | null;
  gpsSource: "browser" | "exif" | "none";
};

/** Try to get GPS coords. Resolves with null fields if permission denied / unsupported. */
export function tryGetGps(): Promise<{
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
}> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve({ latitude: null, longitude: null, accuracy: null });
      return;
    }
    const timer = setTimeout(
      () => resolve({ latitude: null, longitude: null, accuracy: null }),
      8000,
    );
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? null,
        });
      },
      () => {
        clearTimeout(timer);
        resolve({ latitude: null, longitude: null, accuracy: null });
      },
      { enableHighAccuracy: true, timeout: 7000, maximumAge: 30_000 },
    );
  });
}

/** Read EXIF tags (GPS, dates, camera) from a file. Never throws. */
export async function readExif(file: File): Promise<Record<string, unknown> | null> {
  try {
    const exif = await exifr.parse(file, {
      gps: true,
      tiff: true,
      exif: true,
      pick: [
        "latitude", "longitude", "GPSAltitude", "GPSHPositioningError",
        "DateTimeOriginal", "CreateDate", "ModifyDate",
        "Make", "Model", "Software", "Orientation", "LensModel",
      ],
    });
    return (exif as Record<string, unknown>) ?? null;
  } catch {
    return null;
  }
}

/** Convert exif into a JSON-safe object (Date → ISO string). */
export function sanitizeExifForUpload(
  exif: Record<string, unknown> | null,
): Record<string, any> | null {
  if (!exif) return null;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(exif)) {
    if (v == null) continue;
    if (v instanceof Date) out[k] = v.toISOString();
    else if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") out[k] = v;
    else if (typeof v === "object") {
      try { out[k] = JSON.parse(JSON.stringify(v)); } catch { /* skip */ }
    }
  }
  return out;
}

/** Build a PhotoEntry from a File, fetching GPS + EXIF. */
export async function buildPhotoEntry(
  file: File,
  browserGps: { latitude: number | null; longitude: number | null; accuracy: number | null },
  deviceInfo: string,
): Promise<PhotoEntry> {
  const exif = await readExif(file);
  let latitude = browserGps.latitude;
  let longitude = browserGps.longitude;
  let accuracy = browserGps.accuracy;
  let gpsSource: PhotoEntry["gpsSource"] = browserGps.latitude !== null ? "browser" : "none";
  if (latitude === null && exif) {
    const exLat = typeof exif.latitude === "number" ? (exif.latitude as number) : null;
    const exLng = typeof exif.longitude === "number" ? (exif.longitude as number) : null;
    if (exLat !== null && exLng !== null) {
      latitude = exLat;
      longitude = exLng;
      const hpe = (exif as any).GPSHPositioningError;
      accuracy = typeof hpe === "number" ? hpe : null;
      gpsSource = "exif";
    }
  }
  let takenAt = new Date().toISOString();
  const exifDate = exif?.DateTimeOriginal ?? exif?.CreateDate;
  if (exifDate instanceof Date && !isNaN(exifDate.getTime())) {
    takenAt = exifDate.toISOString();
  } else if (typeof exifDate === "string") {
    const d = new Date(exifDate);
    if (!isNaN(d.getTime())) takenAt = d.toISOString();
  }
  return {
    file,
    previewUrl: URL.createObjectURL(file),
    latitude,
    longitude,
    accuracy,
    takenAt,
    deviceInfo,
    exifMetadata: exif
      ? { ...exif, gps_source: gpsSource, browser_gps: browserGps }
      : { gps_source: gpsSource, browser_gps: browserGps },
    gpsSource,
  };
}

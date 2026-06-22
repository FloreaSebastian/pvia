/**
 * Shared TTLs for Supabase Storage signed URLs.
 *
 * Goal: harmonize signed-URL lifetimes across the codebase so client and
 * server agree on cache windows, audit windows, and renewal expectations.
 * All durations are in **seconds**.
 *
 * Use these constants in EVERY `storage.createSignedUrl(path, ttl)` call.
 */

/** Photos (PV / reserve / lift item photos, before/after, etc.) — 1 hour. */
export const SIGNED_URL_PHOTO_TTL = 60 * 60;

/** PDFs (PV signed, reserve-lift client/internal) — 1 hour. */
export const SIGNED_URL_PDF_TTL = 60 * 60;

/** Expertise / audit ZIP exports — 1 hour (upper bound). */
export const SIGNED_URL_EXPORT_TTL = 60 * 60;

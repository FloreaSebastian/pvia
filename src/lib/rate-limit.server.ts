import { supabaseAdmin } from "@/integrations/supabase/client.server";

export class RateLimitError extends Error {
  statusCode = 429;
  constructor(public retryAfterSec: number, bucket: string) {
    super(`Trop de requêtes (${bucket}). Réessayez dans ${retryAfterSec}s.`);
    this.name = "RateLimitError";
  }
}

/**
 * Sliding window rate limit backed by `public.rate_limits`.
 * Returns silently on success, throws RateLimitError on overflow.
 *
 * NOTE (transparence) : ce limiteur est applicatif (pas edge). Il ralentit
 * les abus mais ne remplace PAS un WAF type Cloudflare. Pour login auth
 * Supabase, le rate-limit natif Supabase s'applique en amont.
 */
export async function enforceRateLimit(opts: {
  bucket: string;
  key: string;
  limit: number;
  windowSec: number;
}) {
  const { bucket, key, limit, windowSec } = opts;
  // Round window start to bucket boundary
  const now = Date.now();
  const windowMs = windowSec * 1000;
  const windowStart = new Date(Math.floor(now / windowMs) * windowMs).toISOString();
  const retryAfter = () =>
    Math.max(1, Math.ceil((Math.floor(now / windowMs) * windowMs + windowMs - now) / 1000));

  // Compteur ATOMIQUE côté base (INSERT ... ON CONFLICT DO UPDATE count = count + 1).
  // Un upsert PostgREST avec `count: 1` réécrivait la valeur à 1 à chaque appel :
  // le compteur ne montait jamais et aucune limite ne se déclenchait.
  const { data, error } = await supabaseAdmin.rpc("increment_rate_limit", {
    _bucket: bucket,
    _key: key,
    _window_start: windowStart,
  });

  if (error) {
    // Fail-open volontaire : une panne du compteur ne doit pas bloquer la
    // connexion des clients. L'incident est tracé côté serveur.
    console.error("enforceRateLimit: increment_rate_limit failed", { bucket, error: error.message });
    return;
  }

  const count = typeof data === "number" ? data : Number(data ?? 0);
  if (count > limit) throw new RateLimitError(retryAfter(), bucket);
}


/** Extracts a best-effort client IP from a Request. */
export function getClientIp(request: Request): string {
  const h = request.headers;
  return (
    h.get("cf-connecting-ip") ||
    h.get("x-real-ip") ||
    (h.get("x-forwarded-for") ?? "").split(",")[0].trim() ||
    "unknown"
  );
}

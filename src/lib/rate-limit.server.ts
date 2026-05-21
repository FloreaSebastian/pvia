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

  // Upsert with atomic increment
  const { data, error } = await supabaseAdmin
    .from("rate_limits")
    .upsert(
      { bucket, key, window_start: windowStart, count: 1 },
      { onConflict: "bucket,key,window_start", ignoreDuplicates: false }
    )
    .select("count")
    .single();

  if (error) {
    // Fallback: increment existing row
    const { data: existing } = await supabaseAdmin
      .from("rate_limits")
      .select("id,count")
      .eq("bucket", bucket)
      .eq("key", key)
      .eq("window_start", windowStart)
      .maybeSingle();
    if (existing) {
      const next = existing.count + 1;
      await supabaseAdmin.from("rate_limits").update({ count: next }).eq("id", existing.id);
      if (next > limit) {
        const retry = Math.max(1, Math.ceil((Math.floor(now / windowMs) * windowMs + windowMs - now) / 1000));
        throw new RateLimitError(retry, bucket);
      }
    }
    return;
  }

  // First insert returns count=1. If it already existed, manually increment.
  if (data && data.count === 1) return;

  const { data: row } = await supabaseAdmin
    .from("rate_limits")
    .select("id,count")
    .eq("bucket", bucket)
    .eq("key", key)
    .eq("window_start", windowStart)
    .single();
  if (!row) return;
  const next = row.count + 1;
  await supabaseAdmin.from("rate_limits").update({ count: next }).eq("id", row.id);
  if (next > limit) {
    const retry = Math.max(1, Math.ceil((Math.floor(now / windowMs) * windowMs + windowMs - now) / 1000));
    throw new RateLimitError(retry, bucket);
  }
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

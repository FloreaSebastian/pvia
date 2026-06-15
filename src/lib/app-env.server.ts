/**
 * ST-M6 — Explicit application environment.
 *
 * Replaces hostname sniffing with an explicit APP_ENV env var.
 * Falls back to a best-effort heuristic so existing local/preview
 * deployments keep working until APP_ENV is wired everywhere.
 *
 * Values:
 *   - "local"      : local dev (bun dev / vite dev)
 *   - "preview"    : Lovable preview / *.lovable.app dev hosts
 *   - "production" : published custom domain
 */
export type AppEnv = "local" | "preview" | "production";

export function getServerAppEnv(): AppEnv {
  const raw = (process.env.APP_ENV ?? "").toLowerCase();
  if (raw === "local" || raw === "preview" || raw === "production") return raw;

  // Heuristic fallback from PUBLIC_APP_URL.
  const url = process.env.PUBLIC_APP_URL ?? "";
  if (!url) return "local";
  if (url.includes("localhost") || url.startsWith("http://127.")) return "local";
  if (url.includes("id-preview") || url.includes("-dev.lovable.app")) return "preview";
  return "production";
}

/** Returns the Stripe env that pairs with this APP_ENV. */
export function getServerStripeEnv(): "sandbox" | "live" {
  return getServerAppEnv() === "production" ? "live" : "sandbox";
}

/** True when production Stripe must be used. */
export function isProductionEnv(): boolean {
  return getServerAppEnv() === "production";
}

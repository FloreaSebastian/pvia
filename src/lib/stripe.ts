/**
 * Returns the current Stripe environment.
 *
 * ST-M6: prefer explicit `VITE_APP_ENV` over hostname sniffing so a
 * production custom domain mapped to a preview project does NOT silently
 * promote to live Stripe. Only `VITE_APP_ENV === "production"` enables live.
 *
 * Hostname remains as a defence-in-depth fallback for older deployments.
 */
export function getStripeEnvironment(): "sandbox" | "live" {
  const explicit = (import.meta.env.VITE_APP_ENV ?? "").toLowerCase();
  if (explicit === "production") return "live";
  if (explicit === "preview" || explicit === "local") return "sandbox";

  if (typeof window === "undefined") return "sandbox";
  const host = window.location.hostname;
  if (host.includes("-dev") || host.includes("id-preview") || host === "localhost" || host.startsWith("127.")) {
    return "sandbox";
  }
  return "live";
}

export { PLAN_LABELS, PLAN_PRICE_IDS } from "./plans";

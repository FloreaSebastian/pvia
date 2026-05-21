/**
 * Returns the current Stripe environment.
 * In dev/preview: sandbox. Published builds use live.
 * Detected via the host so the published site automatically switches.
 */
export function getStripeEnvironment(): "sandbox" | "live" {
  if (typeof window === "undefined") return "sandbox";
  const host = window.location.hostname;
  // Lovable preview hosts contain "-dev" or "id-preview" or are localhost.
  if (host.includes("-dev") || host.includes("id-preview") || host === "localhost" || host.startsWith("127.")) {
    return "sandbox";
  }
  return "live";
}

export const PLAN_LABELS: Record<string, string> = {
  starter: "Starter",
  pro: "Pro",
  enterprise: "Entreprise",
};

export const PLAN_PRICE_IDS = {
  starter: "starter_monthly",
  pro: "pro_monthly",
  enterprise: "enterprise_monthly",
} as const;

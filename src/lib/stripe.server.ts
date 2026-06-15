import Stripe from "stripe";

const getEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is not configured`);
  return value;
};

export type StripeEnv = "sandbox" | "live";

const GATEWAY_STRIPE_BASE = "https://connector-gateway.lovable.dev/stripe";

export function getConnectionApiKey(env: StripeEnv): string {
  return env === "sandbox"
    ? getEnv("STRIPE_SANDBOX_API_KEY")
    : getEnv("STRIPE_LIVE_API_KEY");
}

export function createStripeClient(env: StripeEnv): Stripe {
  const connectionApiKey = getConnectionApiKey(env);
  const lovableApiKey = getEnv("LOVABLE_API_KEY");

  return new Stripe(connectionApiKey, {
    apiVersion: "2026-03-25.dahlia",
    httpClient: Stripe.createFetchHttpClient(((input: any, init?: RequestInit) => {
      const gatewayUrl = input.toString().replace("https://api.stripe.com", GATEWAY_STRIPE_BASE);
      return fetch(gatewayUrl, {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init?.headers).entries()),
          "X-Connection-Api-Key": connectionApiKey,
          "Lovable-API-Key": lovableApiKey,
        },
      });
    }) as typeof fetch),
  });
}

/**
 * ST-M5 — per-env singletons.
 *
 * Avoid re-instantiating the Stripe SDK on every API call. The Stripe client
 * is stateless across requests, so a per-isolate singleton is safe and saves
 * the gateway+HMAC setup work. Cached separately per env to prevent
 * sandbox↔live cross-talk.
 */
const _stripeSingletons: Partial<Record<StripeEnv, Stripe>> = {};
let _stripeInstantiations = 0;

export function getStripeClient(env: StripeEnv): Stripe {
  const cached = _stripeSingletons[env];
  if (cached) return cached;
  _stripeInstantiations++;
  const c = createStripeClient(env);
  _stripeSingletons[env] = c;
  return c;
}

export function getStripeSingletonStats() {
  return {
    instantiations: _stripeInstantiations,
    envsCached: Object.keys(_stripeSingletons),
  };
}

export async function verifyWebhook(req: Request, env: StripeEnv): Promise<{ type: string; data: { object: any } }> {
  const signature = req.headers.get("stripe-signature");
  const body = await req.text();
  const secret = env === "sandbox"
    ? getEnv("PAYMENTS_SANDBOX_WEBHOOK_SECRET")
    : getEnv("PAYMENTS_LIVE_WEBHOOK_SECRET");

  if (!signature || !body) throw new Error("Missing signature or body");

  let timestamp: string | undefined;
  const v1Signatures: string[] = [];
  for (const part of signature.split(",")) {
    const [key, value] = part.split("=", 2);
    if (key === "t") timestamp = value;
    if (key === "v1") v1Signatures.push(value);
  }
  if (!timestamp || v1Signatures.length === 0) throw new Error("Invalid signature format");

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (age > 300) throw new Error("Webhook timestamp too old");

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`));
  const expected = Buffer.from(new Uint8Array(signed)).toString("hex");

  if (!v1Signatures.includes(expected)) throw new Error("Invalid webhook signature");
  return JSON.parse(body);
}

/** Maps Stripe price lookup_key → internal plan key. */
export function priceToPlan(price: any): "starter" | "pro" | "enterprise" | null {
  const key = price?.lookup_key || price?.metadata?.lovable_external_id || "";
  if (key.startsWith("starter")) return "starter";
  if (key.startsWith("pro")) return "pro";
  if (key.startsWith("enterprise")) return "enterprise";
  return null;
}

/**
 * ST-C4 — Guard environnement Stripe.
 *
 * Verifies that the required credentials for the requested env are present
 * and roughly shaped correctly. Returns a structured report instead of
 * throwing so callers can surface mismatch details (health/deep, go-live).
 *
 * NOTE on key prefixes: in this project the `STRIPE_*_API_KEY` env vars are
 * connector-gateway connection identifiers, not raw Stripe secret keys, so
 * they typically don't carry the `sk_live_` / `sk_test_` prefixes. We still
 * accept a real Stripe secret key shape when present (defence in depth) and
 * always validate the matching webhook secret prefix (`whsec_`).
 */
export type StripeEnvReport = {
  env: StripeEnv;
  ok: boolean;
  errors: string[];
  warnings: string[];
};

export function checkStripeEnv(env: StripeEnv): StripeEnvReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const apiKey = env === "live" ? process.env.STRIPE_LIVE_API_KEY : process.env.STRIPE_SANDBOX_API_KEY;
  const whSecret = env === "live"
    ? process.env.PAYMENTS_LIVE_WEBHOOK_SECRET
    : process.env.PAYMENTS_SANDBOX_WEBHOOK_SECRET;

  if (!apiKey) errors.push(`API key missing (${env === "live" ? "STRIPE_LIVE_API_KEY" : "STRIPE_SANDBOX_API_KEY"})`);
  if (!whSecret) errors.push(`Webhook secret missing (${env === "live" ? "PAYMENTS_LIVE_WEBHOOK_SECRET" : "PAYMENTS_SANDBOX_WEBHOOK_SECRET"})`);

  // If a raw Stripe SK shape leaked into the wrong slot, refuse outright.
  if (apiKey?.startsWith("sk_live_") && env === "sandbox") {
    errors.push("STRIPE_SANDBOX_API_KEY appears to be a LIVE Stripe secret key");
  }
  if (apiKey?.startsWith("sk_test_") && env === "live") {
    errors.push("STRIPE_LIVE_API_KEY appears to be a TEST Stripe secret key");
  }
  // Webhook secret prefix sanity (Stripe always uses whsec_)
  if (whSecret && !whSecret.startsWith("whsec_")) {
    errors.push(`Webhook secret for ${env} does not look like a Stripe whsec_ value`);
  }

  return { env, ok: errors.length === 0, errors, warnings };
}

/**
 * Throws if the env-specific credentials are missing or mismatched.
 * Use at the top of webhook handlers / before any Stripe API call.
 */
export function assertStripeEnvConsistent(env: StripeEnv): void {
  const r = checkStripeEnv(env);
  if (!r.ok) {
    throw new Error(`STRIPE_ENV_MISMATCH:${env}: ${r.errors.join("; ")}`);
  }
}


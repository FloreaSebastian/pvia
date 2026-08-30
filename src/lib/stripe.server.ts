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
export function priceToPlan(price: any): "starter" | "pro" | "business" | "enterprise" | null {
  const key = price?.lookup_key || price?.metadata?.lovable_external_id || "";
  if (key.startsWith("starter")) return "starter";
  if (key.startsWith("pro")) return "pro";
  if (key.startsWith("business")) return "business";
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

/* ------------------------------------------------------------------ *
 * Garde de conformité fiscale LIVE (TVA).
 *
 * Stripe Tax ne peut collecter la TVA que si le compte possède un
 * enregistrement fiscal ACTIF pour le pays concerné. Sans enregistrement
 * France actif, une session Checkout LIVE encaisserait un paiement à 0 %
 * de TVA — irréversible et non conforme. On échoue donc en amont (live
 * uniquement ; sandbox/dev ne sont jamais bloqués).
 *
 * Le résultat est mis en cache 10 minutes par isolate : au plus un appel
 * API supplémentaire par tranche de 10 min, coût négligeable.
 * ------------------------------------------------------------------ */

const TAX_READY_TTL_MS = 10 * 60_000;
let _taxReadyCache: { ok: boolean; at: number } | null = null;

export const TAX_NOT_READY_MESSAGE =
  "Le paiement en ligne est momentanément indisponible : la configuration de facturation (TVA) de PVIA est en cours de finalisation. Écrivez-nous à contact@pvia.fr, nous activons votre formule manuellement.";

/** `true` si un enregistrement TVA France actif existe sur le compte Stripe. */
export async function hasActiveFrenchTaxRegistration(stripe: Stripe): Promise<boolean> {
  const regs = await (stripe as unknown as {
    tax: { registrations: { list: (p: Record<string, unknown>) => Promise<{ data: Array<{ country?: string; status?: string }> }> } };
  }).tax.registrations.list({ status: "active", limit: 100 });
  return regs.data.some((r) => r.country === "FR" && r.status === "active");
}

/** Fail-closed en LIVE tant qu'aucun enregistrement TVA France actif n'existe. */
export async function assertTaxComplianceReady(env: StripeEnv, stripe: Stripe): Promise<void> {
  if (env !== "live") return;
  const now = Date.now();
  if (_taxReadyCache && now - _taxReadyCache.at < TAX_READY_TTL_MS) {
    if (_taxReadyCache.ok) return;
    throw new Error(TAX_NOT_READY_MESSAGE);
  }
  let ok = false;
  try {
    ok = await hasActiveFrenchTaxRegistration(stripe);
  } catch (e) {
    console.error("[billing] lecture des enregistrements fiscaux Stripe impossible:", e);
    ok = false; // fail-closed
  }
  _taxReadyCache = { ok, at: now };
  if (!ok) throw new Error(TAX_NOT_READY_MESSAGE);
}


/* ------------------------------------------------------------------ *
 * Sanitisation des erreurs Stripe (P0 audit billing).
 * Le détail technique reste dans les logs serveur ; le client ne reçoit
 * qu'un message métier neutre en français.
 * ------------------------------------------------------------------ */

/** Motifs techniques qui ne doivent JAMAIS atteindre le navigateur. */
const TECHNICAL_LEAK_PATTERNS = [
  /\bcus_[A-Za-z0-9]+/,
  /\bsub_[A-Za-z0-9]+/,
  /\bprice_[A-Za-z0-9]+/,
  /\bprod_[A-Za-z0-9]+/,
  /\bcs_(test|live)_[A-Za-z0-9]+/,
  /\bin_[A-Za-z0-9]{10,}/,
  /\bpi_[A-Za-z0-9]{10,}/,
  /\bwhsec_[A-Za-z0-9]+/,
  /\bsk_(test|live)_/,
  /\breq_[A-Za-z0-9]{6,}/,
  /No such /i,
  /StripeError|StripeInvalidRequestError|api\.stripe\.com/i,
  /PGRST|service_role|supabase|jwt/i,
  /ZodError|"issues"/i,
  /lookup_key/i,
];

export function containsTechnicalLeak(message: string): boolean {
  return TECHNICAL_LEAK_PATTERNS.some((r) => r.test(message));
}

/**
 * Journalise l'erreur brute côté serveur et renvoie une Error portant un
 * message métier neutre, sûr à afficher côté client.
 */
export function sanitizeStripeError(error: unknown, fallback: string): Error {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error("[billing] erreur Stripe (détail serveur uniquement):", raw);
  return new Error(fallback);
}

/** Messages métier standardisés. */
export const BILLING_MESSAGES = {
  checkout: "Impossible de démarrer le paiement pour le moment. Réessayez dans quelques instants.",
  portal: "Impossible d'ouvrir la gestion de votre abonnement pour le moment. Réessayez dans quelques instants.",
  generic: "Une erreur est survenue sur la facturation. Réessayez dans quelques instants.",
} as const;

/**
 * Audit TVA — lecture seule (+ 1 session Checkout SANDBOX de test, expirée
 * immédiatement, aucun paiement). Ne modifie AUCUN objet live.
 *
 * Usage : bun scripts/tva-audit.ts
 */
import { createStripeClient, type StripeEnv } from "../src/lib/stripe.server";

const PVIA_KEYS = [
  "starter_monthly",
  "starter_annual",
  "pro_monthly",
  "pro_annual",
  "business_monthly",
  "business_annual",
];

async function inventory(env: StripeEnv) {
  const stripe = createStripeClient(env);
  console.log(`\n=== ${env.toUpperCase()} — inventaire des Prices ===`);
  const all: any[] = [];
  for await (const p of stripe.prices.list({ limit: 100, expand: ["data.product"] })) {
    all.push(p);
  }
  for (const p of all) {
    const isPvia = p.lookup_key && PVIA_KEYS.includes(p.lookup_key);
    console.log(
      [
        isPvia ? "PVIA " : "AUTRE",
        p.id,
        `lookup=${p.lookup_key ?? "-"}`,
        `produit=${typeof p.product === "object" ? p.product.name : p.product}`,
        `montant=${p.unit_amount}`,
        `devise=${p.currency}`,
        `intervalle=${p.recurring?.interval ?? "one_time"}`,
        `tax_behavior=${p.tax_behavior}`,
        `actif=${p.active}`,
      ].join(" | "),
    );
  }
  const pvia = all.filter((p) => p.lookup_key && PVIA_KEYS.includes(p.lookup_key));
  const autres = all.filter((p) => !(p.lookup_key && PVIA_KEYS.includes(p.lookup_key)));
  console.log(
    `-> PVIA: ${pvia.length} | autres: ${autres.length} | autres en exclusive: ${
      autres.filter((p) => p.tax_behavior === "exclusive").length
    }`,
  );

  // Enregistrements fiscaux Stripe Tax (lecture seule)
  try {
    const regs = await (stripe as any).tax.registrations.list({ limit: 100 });
    console.log(
      `-> tax registrations (${env}):`,
      regs.data.map((r: any) => `${r.country}/${r.status}`).join(", ") || "AUCUNE",
    );
  } catch (e: any) {
    console.log(`-> tax registrations (${env}): erreur lecture: ${e?.message}`);
  }
}

async function sandboxCheckoutProof() {
  const stripe = createStripeClient("sandbox");
  console.log("\n=== SANDBOX — session Checkout de preuve (paramètres production) ===");
  const prices = await stripe.prices.list({ lookup_keys: ["pro_monthly"], limit: 1 });
  const price = prices.data[0];
  if (!price) throw new Error("price pro_monthly introuvable en sandbox");

  const customer = await stripe.customers.create({
    email: "audit-tva-test@pvia.invalid",
    metadata: { audit: "tva-runtime-proof" },
  });
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customer.id,
      line_items: [{ price: price.id, quantity: 1 }],
      success_url: "https://pvia.fr/billing?status=success&session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "https://pvia.fr/billing?status=cancel",
      automatic_tax: { enabled: true },
      billing_address_collection: "required",
      customer_update: { address: "auto", name: "auto" },
      tax_id_collection: { enabled: true, required: "if_supported" },
      subscription_data: { metadata: { companyId: "audit", userId: "audit" } },
      metadata: { companyId: "audit", userId: "audit" },
    });
    console.log("session créée:", session.id, "| status:", session.status);
    console.log("automatic_tax:", JSON.stringify(session.automatic_tax));
    console.log("tax_id_collection:", JSON.stringify(session.tax_id_collection));
    await stripe.checkout.sessions.expire(session.id);
    console.log("session expirée OK");
  } finally {
    await stripe.customers.del(customer.id);
    console.log("customer de test supprimé");
  }
}

await inventory("sandbox");
await inventory("live");
await sandboxCheckoutProof();

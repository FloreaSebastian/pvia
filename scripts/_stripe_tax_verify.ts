import { createStripeClient } from "../src/lib/stripe.server";
const s = createStripeClient("sandbox");
const regs: any = await (s as any).tax.registrations.list({ limit: 20 });
if (!regs.data.some((r: any) => r.country === "FR" && r.status === "active")) {
  const r = await (s as any).tax.registrations.create({ country: "FR", country_options: { fr: { type: "standard" } }, active_from: "now" });
  console.log("created FR registration (sandbox)", r.id, r.status);
}
const cust = await s.customers.create({ email: "tva-test@example.com", address: { country: "FR", line1: "1 rue de Test", city: "Paris", postal_code: "75001" }, name: "Test TVA" });
const price = (await s.prices.list({ lookup_keys: ["starter_monthly"], limit: 1 })).data[0];
const sess = await s.checkout.sessions.create({
  mode: "subscription", customer: cust.id, line_items: [{ price: price.id, quantity: 1 }],
  success_url: "https://pvia.fr/billing?status=success", cancel_url: "https://pvia.fr/billing?status=cancel",
  automatic_tax: { enabled: true }, billing_address_collection: "required",
  customer_update: { address: "auto", name: "auto" },
  tax_id_collection: { enabled: true, required: "if_supported" },
});
console.log("session", sess.id, "subtotal=", sess.amount_subtotal, "tax=", sess.total_details?.amount_tax, "total=", sess.amount_total, "automatic_tax=", sess.automatic_tax?.status);
await s.checkout.sessions.expire(sess.id);
await s.customers.del(cust.id);
console.log("cleaned up");

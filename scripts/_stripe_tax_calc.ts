import { createStripeClient } from "../src/lib/stripe.server";
const s = createStripeClient("sandbox");
const price = (await s.prices.list({ lookup_keys: ["starter_monthly"], limit: 1 })).data[0];
const calc: any = await (s as any).tax.calculations.create({
  currency: "eur",
  customer_details: { address: { country: "FR", line1: "1 rue de Test", city: "Paris", postal_code: "75001" }, address_source: "billing" },
  line_items: [{ amount: 1900, reference: "starter_monthly", tax_behavior: "exclusive", tax_code: "txcd_10103001" }],
});
console.log("HT=", calc.amount_total - calc.tax_amount_exclusive, "TVA=", calc.tax_amount_exclusive, "TTC=", calc.amount_total,
  "rate=", JSON.stringify(calc.tax_breakdown?.map((b:any)=>({pct:b.tax_rate_details?.percentage_decimal, amt:b.amount}))));

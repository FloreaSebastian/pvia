import { createStripeClient } from "../src/lib/stripe.server";
const env = (process.argv[2] as "sandbox" | "live") ?? "sandbox";
const s = createStripeClient(env);
const prices = await s.prices.list({ limit: 100 });
for (const p of prices.data) {
  if (p.tax_behavior === "unspecified") {
    try {
      const u = await s.prices.update(p.id, { tax_behavior: "exclusive" });
      console.log("updated", env, p.lookup_key ?? p.id, u.tax_behavior);
    } catch (e: any) { console.log("FAIL", p.lookup_key ?? p.id, e.message); }
  } else console.log("skip", p.lookup_key ?? p.id, p.tax_behavior);
}

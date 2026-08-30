import { createStripeClient } from "../src/lib/stripe.server";
const s = createStripeClient("sandbox");
const prices = await s.prices.list({ limit: 50, expand: ["data.product"] });
for (const p of prices.data) {
  console.log(p.lookup_key, p.unit_amount, p.currency, "tax_behavior=", p.tax_behavior, "recurring=", p.recurring?.interval, "product=", (p.product as any).name, "tax_code=", (p.product as any).tax_code);
}
const acct = await s.accounts.retrieve();
console.log("country", acct.country, "id", acct.id);
try { const settings = await (s as any).tax.settings.retrieve(); console.log("tax settings", JSON.stringify(settings)); } catch(e:any) { console.log("tax settings err", e.message); }
try { const regs = await (s as any).tax.registrations.list({limit:20}); console.log("registrations", regs.data.map((r:any)=>({country:r.country,status:r.status,active_from:r.active_from}))); } catch(e:any){ console.log("regs err", e.message); }

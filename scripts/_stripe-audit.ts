import { createStripeClient } from "../src/lib/stripe.server";
for (const env of ["sandbox","live"] as const) {
  console.log("=====", env.toUpperCase(), "=====");
  const s = createStripeClient(env);
  try {
    const acct = await (s as any).accounts.retrieve();
    console.log("account:", acct.id, "country:", acct.country, "charges_enabled:", acct.charges_enabled);
  } catch (e:any) { console.log("account ERR:", e.message); }
  try {
    const regs = await (s as any).tax.registrations.list({ limit: 100 });
    console.log("tax registrations (all statuses):", JSON.stringify(regs.data.map((r:any)=>({country:r.country,status:r.status}))));
  } catch (e:any) { console.log("tax ERR:", e.message); }
  try {
    const cfgs = await (s as any).billingPortal.configurations.list({ limit: 10 });
    console.log("portal configurations count:", cfgs.data.length);
    for (const c of cfgs.data) {
      console.log("  cfg", c.id, "active:", c.active, "is_default:", c.is_default,
        "| subscription_update.enabled:", c.features?.subscription_update?.enabled,
        "| allowed_updates:", JSON.stringify(c.features?.subscription_update?.default_allowed_updates),
        "| cancel:", c.features?.subscription_cancel?.enabled, c.features?.subscription_cancel?.mode,
        "| pause:", c.features?.subscription_pause?.enabled);
    }
  } catch (e:any) { console.log("portal ERR:", e.message); }
}

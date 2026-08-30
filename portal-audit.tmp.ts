import { createStripeClient } from "./src/lib/stripe.server";
for (const env of ["sandbox","live"] as const) {
  try {
    const s = createStripeClient(env);
    const cfgs = await s.billingPortal.configurations.list({ limit: 10 });
    for (const c of cfgs.data) {
      console.log(env, c.id, "active=", c.active, "default=", c.is_default);
      console.log("   features=", JSON.stringify(c.features));
    }
    if (!cfgs.data.length) console.log(env, "no explicit portal configuration (Stripe default applies)");
  } catch (e: any) { console.log(env, "ERR", e?.message); }
}

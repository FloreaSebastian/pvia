import { createStripeClient } from "../src/lib/stripe.server";
for (const env of ["sandbox","live"] as const) {
  const s = createStripeClient(env);
  try {
    const st: any = await (s as any).tax.settings.retrieve();
    const regs: any = await (s as any).tax.registrations.list({ limit: 20 });
    console.log(env, "status=", st.status, "default_behavior=", st.defaults.tax_behavior, "head_office=", st.head_office?.address?.country, "regs=", JSON.stringify(regs.data.map((r:any)=>({c:r.country,s:r.status}))));
  } catch (e:any) { console.log(env, "err", e.message); }
}

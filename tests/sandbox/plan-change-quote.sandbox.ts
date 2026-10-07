/**
 * Stripe MODE TEST uniquement. Devis revalidé + baisse appliquée à échéance (Test Clock).
 * Aucune donnée PVIA lue ni écrite ; tout est supprimé à la fin.
 *   bun tests/sandbox/plan-change-quote.sandbox.ts
 */
import { createStripeClient } from "../../src/lib/stripe.server";
import {
  applyImmediate,
  buildQuote,
  resolveCatalogPrice,
  retrieveSubscription,
  scheduleChange,
} from "../../src/lib/billing-plan-change.server";
import { quoteDifferences } from "../../src/lib/billing-plan-change";

const stripe = createStripeClient("sandbox");
const results: boolean[] = [];
const cleanup: (() => Promise<unknown>)[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
};
const address = { country: "FR", postal_code: "75001", city: "Paris", line1: "1 rue de test" };

async function customer(testClock?: string) {
  const c = await stripe.customers.create({
    name: "TEST BILLING PLAN CHANGE",
    email: "test-billing-plan-change@example.com",
    address,
    ...(testClock ? { test_clock: testClock } : {}),
    metadata: { purpose: "TEST BILLING PLAN CHANGE" },
  } as any);
  if (!testClock) cleanup.push(() => stripe.customers.del(c.id));
  const pm = await stripe.paymentMethods.attach("pm_card_visa", { customer: c.id });
  await stripe.customers.update(c.id, { invoice_settings: { default_payment_method: pm.id } });
  return c.id;
}
async function sub(cus: string, key: string) {
  const price = await resolveCatalogPrice(stripe, key);
  const s = await stripe.subscriptions.create({ customer: cus, items: [{ price: price.id }], automatic_tax: { enabled: true } });
  cleanup.unshift(() => stripe.subscriptions.cancel(s.id).catch(() => null));
  return s.id;
}

async function run() {
  // A. Devis recalculé avec la même proration_date : identique.
  const cus = await customer();
  const subId = await sub(cus, "starter_monthly");
  const target = await resolveCatalogPrice(stripe, "pro_monthly");
  let s = await retrieveSubscription(stripe, subId);
  const q1 = await buildQuote(stripe, s, target, "immediate");
  await new Promise((r) => setTimeout(r, 2500));
  const q2 = await buildQuote(stripe, s, target, "immediate", q1.preview.prorationDate);
  const d = quoteDifferences(q1.fingerprint, q2.fingerprint, { mode: "immediate" });
  check("même proration_date → devis identique", d.length === 0, d.join(","));

  // B. Adresse modifiée → TVA/contexte différent → refus.
  await stripe.customers.update(cus, { address: { ...address, country: "BE", postal_code: "1000", city: "Bruxelles" } });
  const q3 = await buildQuote(stripe, s, target, "immediate", q1.preview.prorationDate);
  const d3 = quoteDifferences(q1.fingerprint, q3.fingerprint, { mode: "immediate" });
  check("adresse modifiée → devis refusé", d3.includes("taxContext"), d3.join(","));
  await stripe.customers.update(cus, { address });

  // C. Remise ajoutée sur l'abonnement → refus.
  const coupon = await stripe.coupons.create({ percent_off: 10, duration: "once", name: "TEST BILLING PLAN CHANGE" });
  cleanup.push(() => stripe.coupons.del(coupon.id));
  await stripe.subscriptions.update(subId, { discounts: [{ coupon: coupon.id }] } as any);
  s = await retrieveSubscription(stripe, subId);
  const q4 = await buildQuote(stripe, s, target, "immediate", q1.preview.prorationDate);
  const d4 = quoteDifferences(q1.fingerprint, q4.fingerprint, { mode: "immediate" });
  check("remise ajoutée → devis refusé", d4.includes("discounts"), d4.join(","));
  await stripe.subscriptions.update(subId, { discounts: "" } as any);

  // D. Montée qui remplace une baisse programmée : visible dans le devis et tracée.
  {
    const c2 = await customer();
    const s2id = await sub(c2, "pro_monthly");
    let s2 = await retrieveSubscription(stripe, s2id);
    await scheduleChange(stripe, s2, await resolveCatalogPrice(stripe, "starter_monthly"), { idempotencyKey: `tbpc-${s2id}-down`, metadata: {} });
    s2 = await retrieveSubscription(stripe, s2id);
    const biz = await resolveCatalogPrice(stripe, "business_monthly");
    const q = await buildQuote(stripe, s2, biz, "immediate");
    check("devis signale la baisse programmée remplacée", q.replacedSchedule?.priceId === "starter_monthly", String(q.replacedSchedule?.priceId));
    const r = await applyImmediate(stripe, s2, biz, { prorationDate: q.preview.prorationDate, idempotencyKey: `tbpc-${s2id}-up` });
    check("résultat indique la programmation libérée", r.releasedScheduleId === s2.scheduleId && r.outcome === "applied", `${r.outcome}`);
  }

  // E. Test Clock : baisse programmée réellement appliquée à l'échéance.
  const clock = await (stripe as any).testHelpers.testClocks.create({ frozen_time: Math.floor(Date.now() / 1000), name: "TEST BILLING PLAN CHANGE" });
  cleanup.push(() => (stripe as any).testHelpers.testClocks.del(clock.id));
  const cc = await customer(clock.id);
  const price = await resolveCatalogPrice(stripe, "pro_monthly");
  const tsub = await stripe.subscriptions.create({ customer: cc, items: [{ price: price.id }], automatic_tax: { enabled: true } });
  let ts = await retrieveSubscription(stripe, tsub.id);
  await scheduleChange(stripe, ts, await resolveCatalogPrice(stripe, "starter_monthly"), { idempotencyKey: `tbpc-${tsub.id}-clock`, metadata: {} });
  const before = await retrieveSubscription(stripe, tsub.id);
  check("avant échéance : formule actuelle conservée", before.priceId === "pro_monthly");
  await (stripe as any).testHelpers.testClocks.advance(clock.id, { frozen_time: (ts.periodEndUnix ?? 0) + 3600 });
  for (let i = 0; i < 40; i++) {
    const c = await (stripe as any).testHelpers.testClocks.retrieve(clock.id);
    if (c.status === "ready") break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  ts = await retrieveSubscription(stripe, tsub.id);
  const invs = await stripe.invoices.list({ subscription: tsub.id, limit: 5 });
  const renewal = invs.data.find((i) => i.billing_reason === "subscription_cycle");
  check(
    "Test Clock : baisse appliquée à l'échéance, facture au nouveau tarif",
    ts.priceId === "starter_monthly" && !!renewal && (renewal.total_excluding_tax ?? 0) === 1900,
    `price=${ts.priceId} renewalHT=${renewal?.total_excluding_tax} ttc=${renewal?.total}`,
  );
}

try {
  await run();
} catch (e) {
  console.error("ERREUR", e instanceof Error ? e.message : e);
  results.push(false);
} finally {
  for (const c of cleanup) await c().catch(() => null);
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed} PASS / ${failed} FAIL`);
  process.exit(failed ? 1 : 0);
}

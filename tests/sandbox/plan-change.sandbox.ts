/**
 * Scénarios Stripe RÉELS en mode TEST (sandbox) — jamais en production.
 * Crée des clients de test jetables, exécute les changements d'offre via le
 * module serveur, puis nettoie (résiliation + suppression des clients).
 * Aucune donnée PVIA n'est lue ni écrite.
 *
 *   bun tests/sandbox/plan-change.sandbox.ts
 */
import { createStripeClient } from "../../src/lib/stripe.server";
import {
  applyImmediate,
  cancelScheduled,
  previewChange,
  readScheduledChange,
  resolveCatalogPrice,
  retrieveSubscription,
  scheduleChange,
} from "../../src/lib/billing-plan-change.server";
import { decideChange } from "../../src/lib/billing-plan-change";

const stripe = createStripeClient("sandbox");
const results: { name: string; ok: boolean; detail: string }[] = [];
const cleanup: (() => Promise<unknown>)[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
};

async function newCustomerWithSub(pm: string, priceKey: string) {
  const c = await stripe.customers.create({
    name: "PVIA sandbox plan-change",
    email: "sandbox-plan-change@example.com",
    address: { country: "FR", postal_code: "75001", city: "Paris", line1: "1 rue de test" },
    metadata: { purpose: "pvia-sandbox-plan-change-test" },
  });
  cleanup.push(() => stripe.customers.del(c.id));
  const attached = await stripe.paymentMethods.attach(pm, { customer: c.id });
  await stripe.customers.update(c.id, { invoice_settings: { default_payment_method: attached.id } });
  const price = await resolveCatalogPrice(stripe, priceKey);
  const sub = await stripe.subscriptions.create({
    customer: c.id,
    items: [{ price: price.id }],
    automatic_tax: { enabled: true },
    metadata: { purpose: "pvia-sandbox-plan-change-test" },
  });
  cleanup.unshift(() => stripe.subscriptions.cancel(sub.id).catch(() => null));
  return { customer: c.id, subId: sub.id };
}

async function setDefaultPm(customer: string, pm: string) {
  const attached = await stripe.paymentMethods.attach(pm, { customer });
  await stripe.customers.update(customer, { invoice_settings: { default_payment_method: attached.id } });
}

async function run() {
  // 1. Montée payée starter → pro (mensuel)
  {
    const { subId } = await newCustomerWithSub("pm_card_visa", "starter_monthly");
    const sub = await retrieveSubscription(stripe, subId);
    const target = await resolveCatalogPrice(stripe, "pro_monthly");
    const d = decideChange("starter_monthly", "pro_monthly");
    check("décision upgrade immédiat", d.ok && d.mode === "immediate");
    const pv = await previewChange(stripe, sub, target, "immediate");
    check("aperçu upgrade : montant dû > 0", (pv.dueNow?.ht ?? 0) > 0, JSON.stringify(pv.dueNow));
    const key = `sbx-${subId}-up`;
    const r = await applyImmediate(stripe, sub, target, { prorationDate: pv.prorationDate, idempotencyKey: key });
    check("upgrade payé appliqué", r.outcome === "applied" && r.sub.priceId === "pro_monthly", r.outcome);
    // Double requête : même clé d'idempotence → aucun second changement/facture.
    const again = await applyImmediate(stripe, { ...sub }, target, { prorationDate: pv.prorationDate, idempotencyKey: key });
    check("double requête idempotente (même facture)", again.invoiceId === r.invoiceId, `${again.invoiceId}`);
    const invs = await stripe.invoices.list({ subscription: subId, limit: 10 });
    check("une seule facture de prorata", invs.data.filter((i) => i.billing_reason === "subscription_update").length === 1);

    // 2. Mensuel → annuel (même gamme)
    const sub2 = await retrieveSubscription(stripe, subId);
    const annual = await resolveCatalogPrice(stripe, "pro_annual");
    const pv2 = await previewChange(stripe, sub2, annual, "immediate");
    const in300d = Date.now() + 300 * 86_400_000;
    check(
      "aperçu mensuel→annuel : prochaine échéance ~1 an",
      !!pv2.nextBillingAt && new Date(pv2.nextBillingAt).getTime() > in300d,
      `${pv2.nextBillingAt} dû=${JSON.stringify(pv2.dueNow)}`,
    );
    const r2 = await applyImmediate(stripe, sub2, annual, { prorationDate: pv2.prorationDate, idempotencyKey: `sbx-${subId}-annual` });
    check("mensuel→annuel appliqué", r2.outcome === "applied" && r2.sub.priceId === "pro_annual", r2.outcome);

    // 3. Baisse programmée puis annulée
    const sub3 = await retrieveSubscription(stripe, subId);
    const starterA = await resolveCatalogPrice(stripe, "starter_annual");
    const s = await scheduleChange(stripe, sub3, starterA, { idempotencyKey: `sbx-${subId}-down`, metadata: { test: "1" } });
    const after = await retrieveSubscription(stripe, subId);
    check("baisse : formule actuelle conservée", after.priceId === "pro_annual");
    const sc = await readScheduledChange(stripe, after.scheduleId, after.priceId);
    check(
      "baisse programmée à fin de période",
      sc?.priceId === "starter_annual" && sc?.at === sub3.periodEnd,
      `${sc?.priceId} ${sc?.at} vs ${sub3.periodEnd}`,
    );
    await cancelScheduled(stripe, s.scheduleId, `sbx-${subId}-down-cancel`);
    const after2 = await retrieveSubscription(stripe, subId);
    check("annulation de la programmation", !after2.scheduleId && after2.priceId === "pro_annual");

    // 4. Annuel → mensuel programmé, puis montée immédiate qui remplace la programmation
    const sub4 = await retrieveSubscription(stripe, subId);
    const proM = await resolveCatalogPrice(stripe, "pro_monthly");
    await scheduleChange(stripe, sub4, proM, { idempotencyKey: `sbx-${subId}-a2m`, metadata: {} });
    const sub5 = await retrieveSubscription(stripe, subId);
    check("annuel→mensuel programmé", (await readScheduledChange(stripe, sub5.scheduleId, sub5.priceId))?.priceId === "pro_monthly");
    const bizA = await resolveCatalogPrice(stripe, "business_annual");
    const pv5 = await previewChange(stripe, sub5, bizA, "immediate");
    const r5 = await applyImmediate(stripe, sub5, bizA, { prorationDate: pv5.prorationDate, idempotencyKey: `sbx-${subId}-biz` });
    check("montée remplace la programmation", r5.outcome === "applied" && !r5.sub.scheduleId && r5.sub.priceId === "business_annual");
  }

  // 5. Montée avec paiement refusé : ancien tarif conservé
  {
    const { customer, subId } = await newCustomerWithSub("pm_card_visa", "starter_monthly");
    await setDefaultPm(customer, "pm_card_chargeCustomerFail");
    const sub = await retrieveSubscription(stripe, subId);
    const target = await resolveCatalogPrice(stripe, "business_monthly");
    const pv = await previewChange(stripe, sub, target, "immediate");
    const r = await applyImmediate(stripe, sub, target, { prorationDate: pv.prorationDate, idempotencyKey: `sbx-${subId}-fail` });
    const fresh = await retrieveSubscription(stripe, subId);
    check(
      "paiement refusé : changement non appliqué, droits inchangés",
      r.outcome === "payment_failed" && fresh.priceId === "starter_monthly" && fresh.status === "active" && !!fresh.pendingPriceId,
      `${r.outcome} price=${fresh.priceId} status=${fresh.status} pending=${fresh.pendingPriceId}`,
    );
  }

  // 6. Authentification forte requise
  {
    const { customer, subId } = await newCustomerWithSub("pm_card_visa", "starter_monthly");
    await setDefaultPm(customer, "pm_card_authenticationRequired");
    const sub = await retrieveSubscription(stripe, subId);
    const target = await resolveCatalogPrice(stripe, "pro_monthly");
    const pv = await previewChange(stripe, sub, target, "immediate");
    const r = await applyImmediate(stripe, sub, target, { prorationDate: pv.prorationDate, idempotencyKey: `sbx-${subId}-sca` });
    const fresh = await retrieveSubscription(stripe, subId);
    check(
      "SCA : en attente, lien de paiement fourni, ancien tarif conservé",
      r.outcome === "payment_pending" &&
        (r as any).reason === "sca_required" &&
        !!(r as any).hostedInvoiceUrl &&
        fresh.priceId === "starter_monthly",
      `${r.outcome} ${(r as any).reason} price=${fresh.priceId}`,
    );
  }
}

try {
  await run();
} catch (e) {
  console.error("ERREUR", e instanceof Error ? e.message : e);
  results.push({ name: "exécution", ok: false, detail: String(e) });
} finally {
  for (const c of cleanup) await c().catch(() => null);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} PASS / ${failed} FAIL`);
  process.exit(failed ? 1 : 0);
}

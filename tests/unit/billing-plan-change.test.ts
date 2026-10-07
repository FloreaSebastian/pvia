import { describe, expect, it } from "bun:test";
import {
  CHANGE_BLOCK_MESSAGES,
  amountsFromInvoice,
  changeBlockReason,
  classifyPaymentIntentStatus,
  computeOverages,
  decideChange,
  isAllowedPriceId,
  reconcileRequest,
} from "../../src/lib/billing-plan-change";

describe("politique de changement d'offre", () => {
  it("montée de gamme mensuelle → immédiate", () => {
    expect(decideChange("starter_monthly", "pro_monthly")).toEqual({ ok: true, kind: "upgrade", mode: "immediate" });
  });
  it("mensuel → annuel même gamme → immédiat avec prorata", () => {
    expect(decideChange("pro_monthly", "pro_annual")).toEqual({ ok: true, kind: "interval_upgrade", mode: "immediate" });
  });
  it("montée + mensuel → annuel → immédiate", () => {
    expect(decideChange("starter_monthly", "business_annual")).toMatchObject({ kind: "upgrade", mode: "immediate" });
  });
  it("baisse de gamme → programmée fin de période", () => {
    expect(decideChange("business_monthly", "pro_monthly")).toEqual({ ok: true, kind: "downgrade", mode: "scheduled" });
    expect(decideChange("pro_monthly", "starter_annual")).toMatchObject({ kind: "downgrade", mode: "scheduled" });
  });
  it("annuel → mensuel → programmé, même vers une gamme supérieure", () => {
    expect(decideChange("pro_annual", "pro_monthly")).toMatchObject({ kind: "interval_downgrade", mode: "scheduled" });
    expect(decideChange("starter_annual", "business_monthly")).toMatchObject({ kind: "interval_downgrade", mode: "scheduled" });
  });
  it("pendant l'essai : tout changement est immédiat (rien n'est payé)", () => {
    expect(decideChange("business_monthly", "starter_monthly", { trialing: true })).toMatchObject({ mode: "immediate" });
  });
  it("même formule ou prix hors catalogue → refus", () => {
    expect(decideChange("pro_monthly", "pro_monthly")).toEqual({ ok: false, reason: "same" });
    expect(decideChange("pro_monthly", "enterprise_monthly")).toEqual({ ok: false, reason: "invalid_price" });
    expect(decideChange("price_123", "pro_monthly")).toEqual({ ok: false, reason: "invalid_price" });
    expect(isAllowedPriceId("pro_annual")).toBe(true);
    expect(isAllowedPriceId("pro_weekly")).toBe(false);
  });
});

describe("éligibilité", () => {
  const base = { status: "active", stripe_subscription_id: "sub_1", cancel_at_period_end: false, pending_price_id: null };
  it("actif → autorisé", () => expect(changeBlockReason(base)).toBeNull());
  it("aucun abonnement → Checkout requis", () => expect(changeBlockReason(null)).toBe(CHANGE_BLOCK_MESSAGES.none));
  it("impayé → régularisation d'abord (garde impayés conservée)", () => {
    for (const status of ["past_due", "unpaid", "incomplete"])
      expect(changeBlockReason({ ...base, status })).toBe(CHANGE_BLOCK_MESSAGES.regularize);
  });
  it("résilié en fin de période → refus", () =>
    expect(changeBlockReason({ ...base, cancel_at_period_end: true })).toBe(CHANGE_BLOCK_MESSAGES.canceling));
  it("paiement de changement en attente → pas de second changement", () =>
    expect(changeBlockReason({ ...base, pending_price_id: "pro_monthly" })).toBe(CHANGE_BLOCK_MESSAGES.pending));
});

describe("dépassements (jamais destructifs)", () => {
  const business = { plan: "business", max_members: 20, max_pv_per_month: null, can_branding: true, can_technical_visits: true };
  const starter = { plan: "starter", max_members: 1, max_pv_per_month: 10, can_branding: false, can_technical_visits: false };
  it("liste sièges, PV et fonctionnalités perdues", () => {
    const o = computeOverages(business, starter, { seats: 4, pv_this_period: 12 });
    expect(o.map((x) => x.code)).toEqual(["seats", "pv", "feature:can_branding", "feature:can_technical_visits"]);
    expect(o.every((x) => x.blocking === false)).toBe(true);
    expect(o[0]!.message).toContain("Personne n'est supprimé");
  });
  it("montée → aucun dépassement", () => {
    expect(computeOverages(starter, business, { seats: 1, pv_this_period: 3 })).toEqual([]);
  });
});

describe("montants d'aperçu", () => {
  it("HT / TVA / TTC", () => {
    expect(amountsFromInvoice({ currency: "eur", total: 4800, total_excluding_tax: 4000, total_taxes: [{ amount: 800 }] })).toEqual({
      currency: "eur", ht: 4000, tva: 800, ttc: 4800, credit: 0,
    });
  });
  it("crédit en faveur du client", () => {
    expect(amountsFromInvoice({ total: -1200, total_excluding_tax: -1000, total_taxes: [{ amount: -200 }] }).credit).toBe(1200);
  });
});

describe("paiement de la montée", () => {
  it("SCA vs refus", () => {
    expect(classifyPaymentIntentStatus("requires_action")).toBe("sca_required");
    expect(classifyPaymentIntentStatus("requires_payment_method")).toBe("payment_failed");
    expect(classifyPaymentIntentStatus("succeeded")).toBeNull();
  });
});

describe("réconciliation webhooks (ordre indifférent)", () => {
  const imm = { status: "payment_pending" as const, mode: "immediate" as const, to_price_id: "pro_monthly" };
  const snap = (o: Partial<Parameters<typeof reconcileRequest>[1]>) => ({
    price_id: "starter_monthly", pending_price_id: "pro_monthly", schedule_id: null, scheduled_price_id: null, status: "active", ...o,
  });
  it("paiement confirmé → appliqué", () => {
    expect(reconcileRequest(imm, snap({ price_id: "pro_monthly", pending_price_id: null }))).toBe("applied");
  });
  it("toujours en attente → inchangé", () => expect(reconcileRequest(imm, snap({}))).toBeNull());
  it("échec puis paiement réussi → appliqué", () => {
    expect(reconcileRequest({ ...imm, status: "payment_failed" }, snap({ price_id: "pro_monthly", pending_price_id: null }))).toBe("applied");
  });
  it("mise à jour en attente expirée chez Stripe → expirée, ancienne formule conservée", () => {
    expect(reconcileRequest(imm, snap({ pending_price_id: null }))).toBe("expired");
  });
  it("événement ancien rejoué après application : statut terminal jamais réécrit", () => {
    expect(reconcileRequest({ ...imm, status: "applied" }, snap({}))).toBeNull();
  });
  const sch = { status: "scheduled" as const, mode: "scheduled" as const, to_price_id: "starter_monthly", stripe_schedule_id: "sub_sched_1" };
  it("programmé toujours attaché → inchangé", () => {
    expect(reconcileRequest(sch, snap({ price_id: "pro_monthly", pending_price_id: null, schedule_id: "sub_sched_1", scheduled_price_id: "starter_monthly" }))).toBeNull();
  });
  it("date d'effet atteinte → appliqué", () => {
    expect(reconcileRequest(sch, snap({ price_id: "starter_monthly", pending_price_id: null }))).toBe("applied");
  });
  it("programmation libérée (annulation, portail) → annulé", () => {
    expect(reconcileRequest(sch, snap({ price_id: "pro_monthly", pending_price_id: null, schedule_id: null }))).toBe("canceled");
  });
  it("programmation remplacée par une autre formule → caduque", () => {
    expect(reconcileRequest(sch, snap({ price_id: "pro_monthly", pending_price_id: null, schedule_id: "sub_sched_1", scheduled_price_id: "pro_annual" }))).toBe("superseded");
  });
});

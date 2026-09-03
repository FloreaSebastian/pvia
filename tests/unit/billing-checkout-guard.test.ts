import { describe, expect, it } from "bun:test";
import {
  CHECKOUT_GUARD_MESSAGES,
  TRIAL_TOO_CLOSE_MESSAGE,
  computeTrialAlignment,
  decideCheckoutGuard,
} from "../../src/lib/billing-checkout-guard";
import { CHECKOUT_PRICE_IDS, PLAN_PRICE_IDS } from "../../src/lib/plans";
import { computeAccessState } from "../../src/lib/access-state";

const row = (o: Partial<Parameters<typeof decideCheckoutGuard>[0][number]>) => ({
  stripe_customer_id: "cus_x",
  plan: "starter",
  status: "active",
  created_at: "2026-01-01T00:00:00Z",
  ...o,
});

describe("garde anti-doublon Checkout", () => {
  it("essai expiré, formule mémorisée, aucun abonnement → Checkout autorisé", () => {
    expect(decideCheckoutGuard([], "starter")).toEqual({ block: null, customerId: null });
  });

  it("abonnement actif sur une AUTRE formule → portail, pas de second abonnement", () => {
    const d = decideCheckoutGuard([row({ plan: "business", status: "active" })], "starter");
    expect(d.block).toBe(CHECKOUT_GUARD_MESSAGES.otherPlan);
    expect(d.customerId).toBe("cus_x");
  });

  it("abonnement actif sur la même formule → portail", () => {
    expect(decideCheckoutGuard([row({ status: "active" })], "starter").block).toBe(
      CHECKOUT_GUARD_MESSAGES.samePlan,
    );
  });

  it("past_due / unpaid / incomplete → régularisation par le portail", () => {
    for (const status of ["past_due", "unpaid", "incomplete"]) {
      expect(decideCheckoutGuard([row({ status })], "starter").block).toBe(
        CHECKOUT_GUARD_MESSAGES.regularize,
      );
    }
  });

  it("détecte l'impayé même s'il n'est pas la ligne la plus récente ni la formule demandée", () => {
    const rows = [
      row({ plan: "pro", status: "past_due", created_at: "2026-01-01T00:00:00Z" }),
      row({ plan: "starter", status: "canceled", created_at: "2026-06-01T00:00:00Z" }),
    ];
    expect(decideCheckoutGuard(rows, "starter").block).toBe(CHECKOUT_GUARD_MESSAGES.regularize);
  });

  it("historique clos (canceled / incomplete_expired / paused) → Checkout autorisé, Customer réutilisé", () => {
    const rows = [
      row({ status: "canceled", stripe_customer_id: "cus_old", created_at: "2026-01-01T00:00:00Z" }),
      row({ status: "incomplete_expired", stripe_customer_id: "cus_new", created_at: "2026-05-01T00:00:00Z" }),
      row({ status: "paused", stripe_customer_id: null, created_at: "2026-02-01T00:00:00Z" }),
    ];
    const d = decideCheckoutGuard(rows, "starter");
    expect(d.block).toBeNull();
    expect(d.customerId).toBe("cus_new");
  });
});

describe("aucun nouvel essai après expiration", () => {
  const now = Date.parse("2026-09-03T00:00:00Z");

  it("essai terminé → aucun trial_end transmis à Stripe", () => {
    expect(computeTrialAlignment("2026-08-01T00:00:00Z", now)).toEqual({ block: null, trialEnd: null });
  });

  it("aucune date d'essai → aucun trial_end", () => {
    expect(computeTrialAlignment(null, now)).toEqual({ block: null, trialEnd: null });
  });

  it("essai en cours → alignement strict sur la fin d'essai interne", () => {
    const end = "2026-09-10T00:00:00Z";
    expect(computeTrialAlignment(end, now)).toEqual({
      block: null,
      trialEnd: Math.floor(Date.parse(end) / 1000),
    });
  });

  it("moins de 48 h restantes → refus, jamais de prélèvement anticipé", () => {
    expect(computeTrialAlignment("2026-09-04T00:00:00Z", now)).toEqual({
      block: TRIAL_TOO_CLOSE_MESSAGE,
      trialEnd: null,
    });
  });
});

describe("périodicités et Price IDs officiels", () => {
  it("monthly et annual couvrent les six tarifs officiels", () => {
    const derived = Object.values(PLAN_PRICE_IDS).flatMap((p) => [p.monthly, p.annual]);
    expect(new Set(derived)).toEqual(new Set(CHECKOUT_PRICE_IDS));
    expect(CHECKOUT_PRICE_IDS).toHaveLength(6);
  });

  it("chaque lookup_key dérive la bonne formule interne", () => {
    for (const [plan, ids] of Object.entries(PLAN_PRICE_IDS)) {
      expect(ids.monthly).toBe(`${plan}_monthly`);
      expect(ids.annual).toBe(`${plan}_annual`);
    }
  });
});

describe("retour de Checkout sans webhook valide", () => {
  it("aucune ligne d'abonnement + essai expiré → droits toujours bloqués", () => {
    const a = computeAccessState(null, { trial_ends_at: "2026-08-01T00:00:00Z" }, Date.parse("2026-09-03T00:00:00Z"));
    expect(a.blocked).toBe(true);
    expect(a.state).toBe("trial_expired");
  });

  it("ligne incomplete (Checkout abandonné) → droits bloqués", () => {
    const a = computeAccessState(
      { status: "incomplete", plan: "starter", current_period_end: null, trial_end: null, cancel_at_period_end: false },
      { trial_ends_at: "2026-08-01T00:00:00Z" },
      Date.parse("2026-09-03T00:00:00Z"),
    );
    expect(a.blocked).toBe(true);
  });
});

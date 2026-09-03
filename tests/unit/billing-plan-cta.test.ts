import { describe, expect, it } from "bun:test";
import { paidCoveredPlan, planCtaKind, regularizePlan } from "../../src/lib/billing-plan-cta";

const kind = (
  cardPlan: string,
  selectedPlan: string,
  sub: { status: string | null; plan: string | null } | null,
  state: string,
  isCustomPricing = false,
) =>
  planCtaKind({
    cardPlan,
    selectedPlan,
    coveredPlan: paidCoveredPlan(sub, state, selectedPlan),
    regularize: regularizePlan(sub, state, selectedPlan),
    isCustomPricing,
  });

describe("état des cartes de formule sur /billing", () => {
  it("essai expiré sans abonnement : la formule mémorisée reste activable", () => {
    expect(kind("starter", "starter", null, "trial_expired")).toBe("activate");
    expect(kind("pro", "starter", null, "trial_expired")).toBe("switch");
  });

  it("canceled arrivé à échéance : activable", () => {
    expect(kind("starter", "starter", { status: "canceled", plan: "starter" }, "canceled")).toBe("activate");
  });

  it("past_due / unpaid : régularisation via portail, pas de nouveau Checkout", () => {
    expect(kind("starter", "starter", { status: "past_due", plan: "starter" }, "past_due")).toBe("regularize");
    expect(kind("starter", "starter", { status: "unpaid", plan: "starter" }, "unpaid")).toBe("regularize");
  });

  it("incomplete : régularisation ; incomplete_expired : activable", () => {
    expect(kind("starter", "starter", { status: "incomplete", plan: "starter" }, "incomplete")).toBe("regularize");
    expect(
      kind("starter", "starter", { status: "incomplete_expired", plan: "starter" }, "incomplete_expired"),
    ).toBe("activate");
  });

  it("paused : activable, jamais « plan actuel »", () => {
    expect(kind("starter", "starter", { status: "paused", plan: "starter" }, "paused")).toBe("activate");
  });

  it("abonnement actif : « plan actuel » désactivé uniquement sur cette formule", () => {
    expect(kind("starter", "starter", { status: "active", plan: "starter" }, "active")).toBe("current");
    expect(kind("pro", "starter", { status: "active", plan: "starter" }, "active")).toBe("switch");
  });

  it("trialing Stripe valide : « plan actuel »", () => {
    expect(kind("pro", "pro", { status: "trialing", plan: "pro" }, "trialing")).toBe("current");
  });

  it("essai interne (trialing sans abonnement) : la formule reste activable", () => {
    expect(kind("starter", "starter", null, "trialing")).toBe("activate");
  });

  it("abonnement actif sur une autre formule", () => {
    expect(kind("pro", "pro", { status: "active", plan: "business" }, "active")).toBe("activate");
    expect(kind("business", "pro", { status: "active", plan: "business" }, "active")).toBe("current");
  });

  it("sursis de résiliation : couvert", () => {
    expect(kind("pro", "pro", { status: "canceled", plan: "pro" }, "canceled_grace")).toBe("current");
  });

  it("formule sur devis : contact commercial", () => {
    expect(kind("enterprise", "starter", null, "trial_expired", true)).toBe("contact");
  });
});

import { describe, expect, it } from "bun:test";
import { computeAccessState, pickAuthoritativeSubscription } from "../../src/lib/access-state";

const NOW = Date.parse("2026-09-03T00:00:00Z");
const iso = (days: number) => new Date(NOW + days * 86_400_000).toISOString();
const company = { trial_ends_at: iso(-30) }; // essai consommé depuis longtemps

const sub = (o: Partial<Parameters<typeof computeAccessState>[0] & object> = {}) => ({
  status: "active",
  plan: "starter",
  current_period_end: iso(20),
  trial_end: null,
  cancel_at_period_end: false,
  ...o,
}) as any;

describe("renouvellement", () => {
  it("invoice.paid → période prolongée, accès maintenu", () => {
    const before = computeAccessState(sub({ current_period_end: iso(0.1) }), company, NOW);
    expect(before.blocked).toBe(false);
    const after = computeAccessState(sub({ current_period_end: iso(30) }), company, NOW);
    expect(after.state).toBe("active");
    expect(after.blocked).toBe(false);
    expect(Date.parse(after.current_period_end!)).toBeGreaterThan(
      Date.parse(before.current_period_end!),
    );
  });

  it("échec de paiement → past_due bloquant, jamais silencieusement actif", () => {
    const a = computeAccessState(sub({ status: "past_due" }), company, NOW);
    expect(a.state).toBe("past_due");
    expect(a.blocked).toBe(true);
  });

  it("relances épuisées → unpaid bloquant", () => {
    expect(computeAccessState(sub({ status: "unpaid" }), company, NOW).blocked).toBe(true);
  });

  it("active sans période, ou période trop ancienne → fail-closed", () => {
    expect(computeAccessState(sub({ current_period_end: null }), company, NOW).blocked).toBe(true);
    expect(computeAccessState(sub({ current_period_end: iso(-10) }), company, NOW).blocked).toBe(true);
  });
});

describe("ordre des événements", () => {
  it("un ancien état canceled ne réactive pas un abonnement actif plus récent", () => {
    const rows = [
      { status: "canceled", plan: "starter", current_period_end: iso(-5), trial_end: null, cancel_at_period_end: false, created_at: iso(-40) },
      { status: "active", plan: "starter", current_period_end: iso(25), trial_end: null, cancel_at_period_end: false, created_at: iso(-1) },
    ];
    expect(pickAuthoritativeSubscription(rows)!.status).toBe("active");
    expect(pickAuthoritativeSubscription([...rows].reverse())!.status).toBe("active");
  });

  it("une tentative incomplete postérieure ne masque pas l'abonnement actif", () => {
    const rows = [
      { status: "active", plan: "pro", current_period_end: iso(20), trial_end: null, cancel_at_period_end: false, created_at: iso(-10) },
      { status: "incomplete", plan: "starter", current_period_end: null, trial_end: null, cancel_at_period_end: false, created_at: iso(-0.1) },
    ];
    const picked = pickAuthoritativeSubscription(rows)!;
    expect(picked.status).toBe("active");
    expect(computeAccessState(picked as any, company, NOW).blocked).toBe(false);
  });
});

describe("résiliation", () => {
  it("cancel_at_period_end conserve l'accès jusqu'à la fin de période", () => {
    const a = computeAccessState(
      sub({ status: "canceled", cancel_at_period_end: true, current_period_end: iso(10) }),
      company, NOW,
    );
    expect(a.state).toBe("canceled_grace");
    expect(a.blocked).toBe(false);
  });

  it("après la fin de période, l'écriture est coupée (lecture conservée côté app)", () => {
    const a = computeAccessState(
      sub({ status: "canceled", cancel_at_period_end: true, current_period_end: iso(-1) }),
      company, NOW,
    );
    expect(a.state).toBe("canceled");
    expect(a.blocked).toBe(true);
  });

  it("résiliation immédiate (sans cancel_at_period_end) bloque tout de suite", () => {
    const a = computeAccessState(
      sub({ status: "canceled", cancel_at_period_end: false, current_period_end: iso(10) }),
      company, NOW,
    );
    expect(a.blocked).toBe(true);
  });

  it("réactivation avant échéance : la ligne repasse active sans doublon", () => {
    const rows = [
      { status: "canceled", plan: "starter", current_period_end: iso(10), trial_end: null, cancel_at_period_end: true, created_at: iso(-30) },
    ];
    // Le webhook met à jour la MÊME ligne (onConflict stripe_subscription_id).
    const reactivated = [{ ...rows[0]!, status: "active", cancel_at_period_end: false }];
    expect(reactivated).toHaveLength(1);
    expect(computeAccessState(reactivated[0] as any, company, NOW).state).toBe("active");
  });
});

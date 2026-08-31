import { describe, expect, it } from "bun:test";
import { computeAccessState, pickAuthoritativeSubscription } from "../../src/lib/access-state";

const NOW = Date.parse("2026-09-01T12:00:00.000Z");
const iso = (days: number) => new Date(NOW + days * 86_400_000).toISOString();

const sub = (o: Partial<{
  status: string;
  plan: string;
  current_period_end: string | null;
  trial_end: string | null;
  cancel_at_period_end: boolean;
}>) => ({
  status: o.status ?? "active",
  plan: o.plan ?? "pro",
  current_period_end: "current_period_end" in o ? o.current_period_end! : iso(20),
  trial_end: o.trial_end ?? null,
  cancel_at_period_end: o.cancel_at_period_end ?? false,
});

describe("computeAccessState — essai unique 14 jours", () => {
  it("sans abonnement, essai en cours → écriture autorisée", () => {
    const r = computeAccessState(null, { trial_ends_at: iso(5) }, NOW);
    expect(r.state).toBe("trialing");
    expect(r.blocked).toBe(false);
  });

  it("sans abonnement, essai terminé → lecture seule", () => {
    const r = computeAccessState(null, { trial_ends_at: iso(-1) }, NOW);
    expect(r.state).toBe("trial_expired");
    expect(r.blocked).toBe(true);
  });

  it("sans abonnement et sans date d'essai → fail-closed", () => {
    const r = computeAccessState(null, { trial_ends_at: null }, NOW);
    expect(r.blocked).toBe(true);
  });

  it("Stripe renvoie trialing alors que l'essai entreprise est consommé → bloqué", () => {
    const r = computeAccessState(
      sub({ status: "trialing", trial_end: iso(10) }),
      { trial_ends_at: iso(-3) },
      NOW,
    );
    expect(r.state).toBe("trial_expired");
    expect(r.blocked).toBe(true);
  });

  it("trialing sans date de fin → fail-closed", () => {
    const r = computeAccessState(
      sub({ status: "trialing", trial_end: null }),
      { trial_ends_at: iso(5) },
      NOW,
    );
    expect(r.blocked).toBe(true);
  });
});

describe("computeAccessState — abonnement payant", () => {
  it("active avec période future → écriture", () => {
    const r = computeAccessState(sub({}), null, NOW);
    expect(r.state).toBe("active");
    expect(r.blocked).toBe(false);
  });

  it("active sans current_period_end → fail-closed", () => {
    const r = computeAccessState(sub({ current_period_end: null }), null, NOW);
    expect(r.state).toBe("blocked");
    expect(r.blocked).toBe(true);
  });

  it("active avec période expirée depuis moins de 3 jours → tolérance de synchro", () => {
    const r = computeAccessState(sub({ current_period_end: iso(-1) }), null, NOW);
    expect(r.blocked).toBe(false);
  });

  it("active avec période expirée depuis plus de 3 jours → bloqué", () => {
    const r = computeAccessState(sub({ current_period_end: iso(-4) }), null, NOW);
    expect(r.blocked).toBe(true);
  });

  it.each([
    ["past_due", "past_due"],
    ["unpaid", "unpaid"],
    ["incomplete", "incomplete"],
    ["incomplete_expired", "incomplete_expired"],
    ["paused", "paused"],
    ["statut_inconnu", "blocked"],
  ])("statut %s → lecture seule (%s)", (status, expected) => {
    const r = computeAccessState(sub({ status }), null, NOW);
    expect(r.state).toBe(expected);
    expect(r.blocked).toBe(true);
  });
});

describe("computeAccessState — résiliation", () => {
  it("résiliation programmée, période future → accès jusqu'à échéance", () => {
    const r = computeAccessState(
      sub({ status: "canceled", cancel_at_period_end: true, current_period_end: iso(10) }),
      null,
      NOW,
    );
    expect(r.state).toBe("canceled_grace");
    expect(r.blocked).toBe(false);
  });

  it("résiliation immédiate (sans cancel_at_period_end) → lecture seule", () => {
    const r = computeAccessState(
      sub({ status: "canceled", cancel_at_period_end: false, current_period_end: iso(10) }),
      null,
      NOW,
    );
    expect(r.state).toBe("canceled");
    expect(r.blocked).toBe(true);
  });

  it("résiliation avec période échue → lecture seule", () => {
    const r = computeAccessState(
      sub({ status: "canceled", cancel_at_period_end: true, current_period_end: iso(-1) }),
      null,
      NOW,
    );
    expect(r.state).toBe("canceled");
    expect(r.blocked).toBe(true);
  });
});

describe("pickAuthoritativeSubscription", () => {
  const row = (o: Partial<any>) => ({
    status: null, plan: "pro", current_period_end: null, trial_end: null,
    cancel_at_period_end: false, created_at: "2026-01-01T00:00:00Z", ...o,
  });

  it("retourne null sans ligne", () => {
    expect(pickAuthoritativeSubscription([])).toBeNull();
    expect(pickAuthoritativeSubscription(null)).toBeNull();
  });

  it("préfère l'abonnement actif à une tentative incomplete plus récente", () => {
    const picked = pickAuthoritativeSubscription([
      row({ status: "incomplete", created_at: "2026-06-01T00:00:00Z" }),
      row({ status: "active", created_at: "2026-01-01T00:00:00Z", current_period_end: "2027-01-01T00:00:00Z" }),
    ]);
    expect(picked?.status).toBe("active");
  });

  it("préfère past_due à canceled", () => {
    const picked = pickAuthoritativeSubscription([
      row({ status: "canceled", created_at: "2026-06-01T00:00:00Z" }),
      row({ status: "past_due" }),
    ]);
    expect(picked?.status).toBe("past_due");
  });

  it("à statut égal, retient la période la plus lointaine", () => {
    const picked = pickAuthoritativeSubscription([
      row({ status: "active", current_period_end: "2026-02-01T00:00:00Z" }),
      row({ status: "active", current_period_end: "2026-09-01T00:00:00Z" }),
    ]);
    expect(picked?.current_period_end).toBe("2026-09-01T00:00:00Z");
  });
});

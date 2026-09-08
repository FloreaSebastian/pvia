import { describe, expect, it } from "bun:test";
import {
  alertState,
  daysUntilParis,
  milestoneForDays,
  parisDateString,
  parisHour,
  planAlerts,
  type ScheduleDoc,
  type SchedulePartner,
} from "@/lib/subcontractor-expiry-schedule";

const partner: SchedulePartner = { id: "p1", name: "Toiture SARL", status: "active", archived_at: null };

function doc(over: Partial<ScheduleDoc> = {}): ScheduleDoc {
  return {
    id: "d1",
    company_id: "c1",
    subcontractor_company_id: "p1",
    doc_type: "decennale",
    label: null,
    expiry_date: "2026-12-01",
    is_required: true,
    is_blocking: true,
    archived_at: null,
    replaced_by_id: null,
    ...over,
  };
}

/** Un instant UTC correspondant à 8h Paris pour une date locale donnée. */
function parisMorning(dateIso: string, summer: boolean) {
  return new Date(`${dateIso}T0${summer ? 6 : 7}:00:00Z`);
}

function expiryAt(days: number, today: string) {
  const t = Date.parse(`${today}T00:00:00Z`) + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

describe("dates locales Europe/Paris", () => {
  it("calcule la date locale, pas la date UTC", () => {
    // 31 mars 2026 23:30 UTC = 1er avril 01:30 à Paris (heure d'été).
    expect(parisDateString(new Date("2026-03-31T23:30:00Z"))).toBe("2026-04-01");
    // 31 octobre 2026 23:30 UTC = 1er novembre 00:30 à Paris (heure d'hiver).
    expect(parisDateString(new Date("2026-10-31T23:30:00Z"))).toBe("2026-11-01");
  });

  it("donne l'heure locale correcte des deux côtés du changement d'heure", () => {
    expect(parisHour(new Date("2026-07-01T06:00:00Z"))).toBe(8); // été UTC+2
    expect(parisHour(new Date("2026-01-15T07:00:00Z"))).toBe(8); // hiver UTC+1
  });

  it("ne décale pas les jalons au passage heure d'été/hiver", () => {
    // Échéance 30 jours après le 15 mars (heure d'hiver) : le jalon J-30
    // doit tomber le 15 mars même si l'échéance est en heure d'été.
    expect(daysUntilParis("2026-04-14", parisMorning("2026-03-15", false))).toBe(30);
    expect(daysUntilParis("2026-11-25", parisMorning("2026-10-26", false))).toBe(30);
  });
});

describe("matrice des jalons", () => {
  it("J-60 / J-30 / J-7 / J0 déclenchent, les autres non", () => {
    expect(milestoneForDays(60)).toBe("j-60");
    expect(milestoneForDays(30)).toBe("j-30");
    expect(milestoneForDays(7)).toBe("j-7");
    expect(milestoneForDays(0)).toBe("j-0");
    for (const d of [90, 59, 31, 29, 8, 6, 1]) expect(milestoneForDays(d)).toBeNull();
  });

  it("après expiration : relance hebdomadaire seulement", () => {
    for (const d of [1, 2, 3, 4, 5, 6, 8, 13]) expect(milestoneForDays(-d)).toBeNull();
    expect(milestoneForDays(-7)).toBe("expired+7");
    expect(milestoneForDays(-14)).toBe("expired+14");
    expect(milestoneForDays(-21)).toBe("expired+21");
  });

  it("qualifie l'état affiché", () => {
    expect(alertState(30)).toBe("expiring_soon");
    expect(alertState(0)).toBe("expiring_today");
    expect(alertState(-7)).toBe("expired");
  });
});

describe("planAlerts", () => {
  const today = "2026-07-01";
  const now = parisMorning(today, true);

  it("planifie exactement une alerte par jalon dû", () => {
    for (const days of [60, 30, 7, 0, -7, -14]) {
      const r = planAlerts([doc({ expiry_date: expiryAt(days, today) })], [], [partner], now);
      expect(r.planned.length).toBe(1);
    }
  });

  it("ne planifie rien à J+1 ni à J-45", () => {
    for (const days of [-1, -3, 45]) {
      const r = planAlerts([doc({ expiry_date: expiryAt(days, today) })], [], [partner], now);
      expect(r.planned.length).toBe(0);
    }
  });

  it("ignore une pièce archivée ou remplacée", () => {
    const e = expiryAt(30, today);
    expect(planAlerts([doc({ expiry_date: e, archived_at: now.toISOString() })], [], [partner], now).planned).toEqual([]);
    expect(planAlerts([doc({ expiry_date: e, replaced_by_id: "d2" })], [], [partner], now).planned).toEqual([]);
  });

  it("neutralise l'ancienne échéance quand une pièce plus récente existe", () => {
    const old = doc({ id: "old", expiry_date: expiryAt(30, today) });
    const fresh = doc({ id: "new", expiry_date: expiryAt(400, today) });
    const r = planAlerts([old, fresh], [], [partner], now);
    expect(r.planned.length).toBe(0);
    expect(r.skipped.some((s) => s.documentId === "old" && s.reason === "superseded_by_newer")).toBe(true);
  });

  it("respecte la règle d'entreprise plutôt que les drapeaux de la pièce", () => {
    const d = doc({ expiry_date: expiryAt(30, today), is_required: true, is_blocking: true });
    const off = planAlerts([d], [{ subcontractor_company_id: "p1", doc_type: "decennale", is_required: false, is_blocking: true }], [partner], now);
    expect(off.planned.length).toBe(0);
    const on = planAlerts([d], [{ subcontractor_company_id: "p1", doc_type: "decennale", is_required: true, is_blocking: false }], [partner], now);
    expect(on.planned[0]!.blocking).toBe(false);
  });

  it("n'alerte pas pour un partenaire suspendu ou archivé", () => {
    const d = doc({ expiry_date: expiryAt(7, today) });
    for (const p of [
      { ...partner, status: "suspended" },
      { ...partner, status: "archived" },
      { ...partner, archived_at: now.toISOString() },
    ]) {
      expect(planAlerts([d], [], [p], now).planned.length).toBe(0);
    }
  });

  it("isole strictement deux tenants ayant la même date", () => {
    const p2: SchedulePartner = { id: "p2", name: "Autre", status: "active", archived_at: null };
    const e = expiryAt(30, today);
    const r = planAlerts(
      [
        doc({ id: "a", company_id: "cA", subcontractor_company_id: "p1", expiry_date: e }),
        doc({ id: "b", company_id: "cB", subcontractor_company_id: "p2", expiry_date: e }),
      ],
      [],
      [partner, p2],
      now,
    );
    expect(r.planned.length).toBe(2);
    const a = r.planned.find((x) => x.document.id === "a")!;
    const b = r.planned.find((x) => x.document.id === "b")!;
    expect(a.document.company_id).toBe("cA");
    expect(a.partner.id).toBe("p1");
    expect(b.document.company_id).toBe("cB");
    expect(b.partner.id).toBe("p2");
  });

  it("ignore une pièce sans échéance ou sans partenaire connu", () => {
    expect(planAlerts([doc({ expiry_date: null })], [], [partner], now).planned).toEqual([]);
    expect(planAlerts([doc({ expiry_date: expiryAt(7, today) })], [], [], now).planned).toEqual([]);
  });
});

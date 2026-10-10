import { describe, expect, it } from "bun:test";
import { loadDashboard, signatureCutoff, dashboardDate } from "../../src/lib/dashboard";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/integrations/supabase/types";
import { VISIT_DRAFT_STATUSES } from "../../src/lib/dashboard";
import {
  groupedVisitPage,
  VISIT_RESUME_SEARCH,
  visitGroupStatuses,
  visitListSearchValidator,
} from "../../src/lib/visites/resume-filter";
import { VisitFiltersSchema } from "../../src/lib/visites/schemas";

function client(fail = false) {
  const requests: { table: string; head: boolean; calls: [string, ...unknown[]][] }[] = [];
  const sb = {
    from(table: string) {
      const entry = { table, head: false, calls: [] as [string, ...unknown[]][] };
      requests.push(entry);
      const chain = new Proxy(
        {},
        {
          get(_, name) {
            if (name === "then")
              return (resolve: (value: unknown) => void) =>
                resolve({
                  error: fail ? { message: "private technical error" } : null,
                  count: 1234,
                  data: entry.head ? null : [],
                });
            return (...args: unknown[]) => {
              entry.calls.push([String(name), ...args]);
              if (name === "select")
                entry.head = !!(args[1] as { head?: boolean } | undefined)?.head;
              return chain;
            };
          },
        },
      );
      return chain;
    },
  } as unknown as SupabaseClient<Database>;
  return { sb, requests };
}
describe("dashboard operational data", () => {
  it("resume URL validates and uses exactly the counted visit statuses", async () => {
    const validated = visitListSearchValidator.parse(VISIT_RESUME_SEARCH);
    expect(validated).toEqual({ group: "a_reprendre" });
    expect(visitListSearchValidator.parse({ group: 123 })).toEqual({ group: "all" });
    expect(visitGroupStatuses("unknown")).toBeUndefined();
    expect(
      VisitFiltersSchema.parse({ companyId: "11111111-1111-4111-8111-111111111111", ...validated })
        .group,
    ).toBe("a_reprendre");
    const { sb, requests } = client();
    await loadDashboard(sb, "company-A", true);
    const visits = requests.filter((r) => r.table === "technical_visits");
    expect(visits).toHaveLength(2);
    for (const r of visits)
      expect(r.calls).toContainEqual(["in", "status", visitGroupStatuses(validated.group)]);
    expect(visitGroupStatuses(validated.group)).toEqual([
      "a_planifier",
      "planifiee",
      "en_cours",
      "a_completer",
    ]);
  });
  it("grouped search pages all four statuses before pagination without losing exact totals", async () => {
    const streams = Object.fromEntries(
      VISIT_DRAFT_STATUSES.map((s, i) => [
        s,
        Array.from({ length: 35 }, (_, n) => ({
          id: `${s}-${n}`,
          scheduled_at:
            n === 34 ? null : new Date(Date.UTC(2026, 9, 10, 0, 140 - n * 4 - i)).toISOString(),
          created_at: "2026-10-01T00:00:00Z",
        })),
      ]),
    );
    const calls: number[] = [];
    const read = async (s: string, offset: number, limit: number) => {
      calls.push(limit);
      return { rows: streams[s].slice(offset, offset + limit), total: streams[s].length };
    };
    const expected = Object.values(streams)
      .flat()
      .sort(
        (a, b) =>
          (b.scheduled_at ?? "").localeCompare(a.scheduled_at ?? "") || a.id.localeCompare(b.id),
      );
    const result = await groupedVisitPage(VISIT_DRAFT_STATUSES, 120, 10, read);
    expect(result.total).toBe(140);
    expect(result.page.map((r) => r.id)).toEqual(expected.slice(120, 130).map((r) => r.id));
    expect(calls.every((n) => n === 10)).toBe(true);
    expect((await groupedVisitPage(VISIT_DRAFT_STATUSES, 150, 10, read)).page).toEqual([]);
  });
  it("counts remain exact beyond list limits and every query is company scoped", async () => {
    const { sb, requests } = client();
    const data = await loadDashboard(sb, "company-A", true, new Date("2026-10-10T12:00:00Z"));
    expect(data.counts).toEqual({
      drafts: 1234,
      pending: 1234,
      reserves: 1234,
      chantiers: 1234,
      blocking: 1234,
      late: 1234,
      visits: 1234,
    });
    expect(data.recent).toEqual([]);
    for (const query of requests) {
      expect(query.calls).toContainEqual(["eq", "company_id", "company-A"]);
      if (query.head) expect(query.calls.some((c) => c[0] === "limit")).toBe(false);
    }
  });
  it("does not query visits without plan permission", async () => {
    const { sb, requests } = client();
    const data = await loadDashboard(sb, "company-A", false);
    expect(data.counts.visits).toBeNull();
    expect(requests.some((r) => r.table === "technical_visits")).toBe(false);
  });
  it("does not replace a failed read with zero", async () => {
    const { sb } = client(true);
    await expect(loadDashboard(sb, "company-A", false)).rejects.toThrow("Réessayez");
  });
  it("signature age is strictly more than seven days from recorded sending", async () => {
    expect(signatureCutoff(new Date("2026-10-10T12:00:00Z"))).toBe("2026-10-03T12:00:00.000Z");
    const { sb, requests } = client();
    await loadDashboard(sb, "company-A", false, new Date("2026-10-10T12:00:00Z"));
    const late = requests.filter((r) => r.calls.some((c) => c[0] === "lt"));
    expect(late).toHaveLength(2);
    for (const r of late)
      expect(r.calls).toContainEqual(["lt", "sent_to_client_at", "2026-10-03T12:00:00.000Z"]);
  });
  it("dates use Paris across UTC midnight and winter time", () => {
    expect(dashboardDate("2026-10-10T23:30:00Z")).toContain("11");
    expect(dashboardDate("2026-12-10T23:30:00Z", true)).toContain("00:30");
  });
  it("blocking reserve query matches canonical non validated / non rejected rule", async () => {
    const { sb, requests } = client();
    await loadDashboard(sb, "company-A", false);
    const blocking = requests.find((r) =>
      r.calls.some((c) => c[0] === "eq" && c[1] === "severity"),
    );
    expect(blocking?.calls).toContainEqual(["eq", "severity", "majeure"]);
    expect(blocking?.calls).toContainEqual(["not", "status", "in", "(validee,rejetee)"]);
  });
});

describe("dashboard events and feature gating", () => {
  it("upcoming events include in-progress ones and exclude cancelled/finished statuses", async () => {
    const { sb, requests } = client();
    const now = new Date("2026-10-10T12:00:00Z");
    await loadDashboard(sb, "company-A", true, now);
    const ev = requests.find((r) => r.table === "chantier_events");
    expect(ev?.calls).toContainEqual(["not", "status", "in", "(annule,termine)"]);
    expect(ev?.calls).toContainEqual([
      "or",
      `start_at.gte.${now.toISOString()},end_at.gte.${now.toISOString()}`,
    ]);
    expect(ev?.calls).toContainEqual(["eq", "company_id", "company-A"]);
  });
  it("never reads technical visits when the feature is unavailable", async () => {
    const { sb, requests } = client();
    const data = await loadDashboard(sb, "company-A", false);
    expect(requests.some((r) => r.table === "technical_visits")).toBe(false);
    expect(data.counts.visits).toBeNull();
  });
  it("labels started events as in progress and postponed as reporte", async () => {
    const { eventPhase } = await import("../../src/lib/dashboard");
    const now = new Date("2026-10-10T12:00:00Z");
    expect(eventPhase({ start_at: "2026-10-10T11:00:00Z", status: "prevu" }, now)).toBe("a_venir");
    expect(eventPhase({ start_at: "2026-10-10T11:00:00Z", status: "en_cours" }, now)).toBe(
      "en_cours",
    );
    expect(eventPhase({ start_at: "2026-10-11T08:00:00Z", status: "prevu" }, now)).toBe("a_venir");
    expect(eventPhase({ start_at: "2026-10-11T08:00:00Z", status: "reporte" }, now)).toBe(
      "reporte",
    );
  });
});

import { describe, expect, it } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/integrations/supabase/types";
import {
  dashboardQueries,
  parisDayBounds,
  dashboardDueDate,
  signatureAge,
  reserveNeedsValidation,
} from "../../src/lib/dashboard-queries";
import { visitListSearchValidator } from "../../src/lib/visites/resume-filter";

const userId = "11111111-1111-4111-8111-111111111111";
const scope = { companyId: "company-A", userId, role: "technicien", canVisit: true };
const now = new Date("2026-10-10T12:00:00Z");
function client(failTable?: string, visitRows: Record<string, number> = {}) {
  const requests: { table: string; head: boolean; calls: [string, ...unknown[]][] }[] = [];
  const sb = {
    from(table: string) {
      const r = { table, head: false, calls: [] as [string, ...unknown[]][] };
      requests.push(r);
      const chain = new Proxy(
        {},
        {
          get(_, method) {
            if (method === "then")
              return (resolve: (v: unknown) => void) => {
                const status = String(
                  r.calls.find((c) => c[0] === "eq" && c[1] === "status")?.[2] ?? "",
                );
                const limit = Number(r.calls.find((c) => c[0] === "limit")?.[1] ?? 5);
                resolve({
                  error: table === failTable ? { message: "technical private error" } : null,
                  count: 12345,
                  data: r.head
                    ? null
                    : table === "technical_visits"
                      ? Array.from({ length: Math.min(visitRows[status] ?? 0, limit) }, (_, i) => ({
                          id: `${status}-${i}`,
                          status,
                        }))
                      : [],
                });
              };
            return (...args: unknown[]) => {
              r.calls.push([String(method), ...args]);
              if (method === "select") r.head = !!(args[1] as { head?: boolean } | undefined)?.head;
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
describe("independent dashboard sections", () => {
  it("a failed reserve section preserves successful PV counts and previews, never zeroes failures", async () => {
    const { sb } = client("pv_reserves");
    const options = dashboardQueries(sb, scope, "today", now);
    const results = await Promise.allSettled([
      options.reserves.queryFn(),
      options.drafts.queryFn(),
      options.recent.queryFn(),
    ]);
    expect(results[0].status).toBe("rejected");
    expect(results[1]).toEqual({ status: "fulfilled", value: 12345 });
    expect(results[2]).toEqual({ status: "fulfilled", value: [] });
  });
  it("exact counts have no limits, previews stay bounded and every read is tenant scoped", async () => {
    const { sb, requests } = client();
    const options = dashboardQueries(sb, scope, "today", now);
    await Promise.all([
      options.reserves.queryFn(),
      options.late.queryFn(),
      options.planning.queryFn(),
      options.visits.queryFn(),
    ]);
    for (const r of requests) {
      expect(r.calls).toContainEqual(["eq", "company_id", "company-A"]);
      if (r.head) expect(r.calls.some((c) => c[0] === "limit")).toBe(false);
      else expect(Number(r.calls.find((c) => c[0] === "limit")?.[1])).toBeLessThanOrEqual(5);
    }
    const reserves = requests.filter((r) => r.table === "pv_reserves");
    for (const r of reserves) {
      expect(r.calls).toContainEqual(["eq", "severity", "majeure"]);
      expect(r.calls).toContainEqual(["not", "status", "in", "(validee,rejetee)"]);
    }
  });
  it("technicians get ONLY assigned visits, status order precedes sampling and managers stay company scoped", async () => {
    const { sb, requests } = client(undefined, { en_cours: 2, a_completer: 2, planifiee: 4 });
    const result = await dashboardQueries(sb, scope, "today", now).visits.queryFn();
    expect(result.count).toBe(12345);
    expect(result.mine).toBe(true);
    expect(result.rows.map((r) => r.status)).toEqual([
      "en_cours",
      "en_cours",
      "a_completer",
      "a_completer",
      "planifiee",
    ]);
    for (const r of requests) expect(r.calls).toContainEqual(["eq", "assigned_to", userId]);
    expect(
      requests.filter((r) => !r.head).map((r) => r.calls.find((c) => c[0] === "limit")?.[1]),
    ).toEqual([5, 3, 1]);
    const manager = client();
    await dashboardQueries(
      manager.sb,
      { ...scope, role: "conducteur_travaux" },
      "today",
      now,
    ).visits.queryFn();
    expect(
      manager.requests.some((r) => r.calls.some((c) => c[0] === "eq" && c[1] === "assigned_to")),
    ).toBe(false);
  });
  it("visits cannot be read without the feature and assignment destination validates", async () => {
    const { sb, requests } = client();
    await expect(
      dashboardQueries(sb, { ...scope, canVisit: false }, "today", now).visits.queryFn(),
    ).rejects.toThrow("formule");
    expect(requests).toHaveLength(0);
    expect(visitListSearchValidator.parse({ group: "a_reprendre", assigned: userId })).toEqual({
      group: "a_reprendre",
      assigned: userId,
    });
    expect(visitListSearchValidator.parse({ assigned: "bad" }).assigned).toBeUndefined();
  });
  it("day overlaps and tomorrow filters are independent exact database queries, not local preview filters", async () => {
    const { sb, requests } = client();
    await dashboardQueries(sb, scope, "today", now).planning.queryFn();
    for (const r of requests) {
      expect(r.calls).toContainEqual(["lt", "start_at", "2026-10-10T22:00:00.000Z"]);
      expect(r.calls).toContainEqual([
        "or",
        "end_at.gt.2026-10-09T22:00:00.000Z,and(end_at.is.null,start_at.gte.2026-10-09T22:00:00.000Z)",
      ]);
      expect(r.calls).toContainEqual(["not", "status", "in", "(annule,termine)"]);
    }
    const future = client();
    await dashboardQueries(future.sb, scope, "upcoming", now).planning.queryFn();
    for (const r of future.requests)
      expect(r.calls).toContainEqual(["gte", "start_at", "2026-10-10T22:00:00.000Z"]);
  });
  it("cache isolation includes tenant, identity, role, feature, period and Paris day", () => {
    const { sb } = client();
    const base = dashboardQueries(sb, scope, "today", now).planning.queryKey;
    for (const s of [
      { ...scope, companyId: "company-B" },
      { ...scope, userId: "user-B" },
      { ...scope, role: "lecture_seule" },
      { ...scope, canVisit: false },
    ])
      expect(dashboardQueries(sb, s, "today", now).planning.queryKey).not.toEqual(base);
    expect(dashboardQueries(sb, scope, "upcoming", now).planning.queryKey).not.toEqual(base);
    expect(
      dashboardQueries(sb, scope, "today", new Date("2026-10-11T12:00:00Z")).planning.queryKey,
    ).not.toEqual(base);
  });
  it("Query refresh failure keeps only the same company's successful data", async () => {
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const good = dashboardQueries(client().sb, scope, "today", now).drafts;
    expect(await cache.fetchQuery(good)).toBe(12345);
    const bad = dashboardQueries(client("pv").sb, scope, "today", now).drafts;
    await expect(cache.fetchQuery({ ...bad, staleTime: 0, retry: false })).rejects.toThrow();
    expect(cache.getQueryData(good.queryKey)).toBe(12345);
    expect(
      cache.getQueryData(
        dashboardQueries(client().sb, { ...scope, companyId: "B" }, "today", now).drafts.queryKey,
      ),
    ).toBeUndefined();
    cache.clear();
  });
});
describe("Paris dates and honest reserve stages", () => {
  it("spring DST day is 23 hours", () => {
    const b = parisDayBounds(new Date("2026-03-29T12:00:00Z"));
    expect(b.start).toBe("2026-03-28T23:00:00.000Z");
    expect(b.end).toBe("2026-03-29T22:00:00.000Z");
  });
  it("autumn DST day is 25 hours and UTC midnight uses the Paris day", () => {
    const b = parisDayBounds(new Date("2026-10-25T12:00:00Z"));
    expect(b.start).toBe("2026-10-24T22:00:00.000Z");
    expect(b.end).toBe("2026-10-25T23:00:00.000Z");
    expect(parisDayBounds(new Date("2026-10-10T23:30:00Z")).date).toBe("2026-10-11");
  });
  it("date-only deadlines preserve the stated day", () => {
    expect(dashboardDueDate("2026-10-25")).toContain("25");
  });
  it("signature age counts elapsed full days from actual sending", () => {
    expect(signatureAge("2026-10-02T13:00:00Z", now)).toBe(7);
  });
  it("lifted reserves require validation, not another intervention", () => {
    expect(reserveNeedsValidation("levee")).toBe(true);
    expect(reserveNeedsValidation("en_attente_validation")).toBe(true);
    expect(reserveNeedsValidation("en_cours")).toBe(false);
  });
});

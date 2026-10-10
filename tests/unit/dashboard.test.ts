import { describe, expect, it } from "bun:test";
import { loadDashboard, signatureCutoff, dashboardDate } from "../../src/lib/dashboard";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/integrations/supabase/types";

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

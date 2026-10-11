import { describe, expect, test } from "bun:test";
import { PDFDocument } from "pdf-lib";
import {
  StatsInputSchema,
  canExportStats,
  computeStats,
  countVariation,
  inRange,
  presetRange,
  previousRange,
  readComplete,
  statsBuckets,
  statsRange,
  statsReadState,
  statsErrorMessage,
  type StatsInput,
  type StatsPv,
  type StatsRows,
} from "@/lib/stats-core";
import {
  buildStatsCsv,
  buildStatsPdf,
  persistStatsPdf,
  statsCsvCell,
  statsExportRows,
} from "@/lib/stats-export";
import { createStatsScope } from "@/lib/stats-scope";
const companyId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const input: StatsInput = { companyId, from: "2026-03-29", to: "2026-03-29", compare: true };
const pv = (id: string, values: Partial<StatsPv> = {}): StatsPv => ({
  id,
  type: "reception",
  status: "brouillon",
  owner_id: userId,
  created_at: "2026-03-29T12:00:00Z",
  signed_at: null,
  sent_to_client_at: null,
  pdf_generated_at: null,
  ...values,
});
const empty = (): StatsRows => ({
  pvs: [],
  reserves: [],
  photos: [],
  emails: [],
  actions: [],
  members: [
    { user_id: userId, name: "Élodie — Entreprise aux noms particulièrement longs et précis" },
  ],
});
describe("statistics Paris periods", () => {
  test("spring day lasts 23 hours with inclusive final day", () => {
    const r = statsRange("2026-03-29", "2026-03-29");
    expect(r.start).toBe("2026-03-28T23:00:00.000Z");
    expect(r.end).toBe("2026-03-29T22:00:00.000Z");
    expect(inRange("2026-03-29T21:59:59.999Z", r)).toBe(true);
    expect(inRange(r.end, r)).toBe(false);
  });
  test("autumn day lasts 25 hours", () => {
    const r = statsRange("2026-10-25", "2026-10-25");
    expect(Date.parse(r.end) - Date.parse(r.start ?? "")).toBe(25 * 3600000);
  });
  test("previous range is adjacent with same calendar duration", () => {
    const r = statsRange("2026-03-28", "2026-03-30");
    const prev = previousRange(r);
    expect(prev?.from).toBe("2026-03-25");
    expect(prev?.to).toBe("2026-03-27");
    expect(prev?.end).toBe(r.start);
    expect(prev?.days).toBe(3);
  });
  test("all history has no comparison", () => {
    const s = computeStats({ ...input, from: undefined }, empty());
    expect(s.previous).toBeNull();
    expect(s.previousRange).toBeNull();
  });
  test("presets include Paris today even when UTC is previous date", () => {
    expect(presetRange("7", new Date("2026-03-28T23:30:00Z"))).toEqual({
      from: "2026-03-23",
      to: "2026-03-29",
    });
    expect(presetRange("12m", new Date("2026-03-29T12:00:00Z"))).toEqual({
      from: "2025-03-30",
      to: "2026-03-29",
    });
  });
  test("invalid day, reversed dates and fabricated type rejected", () => {
    expect(StatsInputSchema.safeParse({ ...input, to: "2026-02-30" }).success).toBe(false);
    expect(StatsInputSchema.safeParse({ ...input, to: "2026-03-28" }).success).toBe(false);
    expect(StatsInputSchema.safeParse({ ...input, pvType: "fake" }).success).toBe(false);
  });
  test("buckets are zero-filled and group Paris midnight", () => {
    const r = statsRange("2026-03-28", "2026-03-30");
    const b = statsBuckets([pv("a", { created_at: "2026-03-28T23:30:00Z" })], r);
    expect(b.rows.map((v) => v.created)).toEqual([0, 1, 0]);
  });
  test("monthly buckets stop at real month end", () => {
    const b = statsBuckets([], statsRange("2025-12-15", "2026-05-01"));
    expect(b.unit).toBe("mois");
    expect(b.rows[0].end).toBe("2025-12-31");
    expect(b.rows[2].end).toBe("2026-02-28");
    expect(b.rows.at(-1)?.end).toBe("2026-05-01");
  });
});
describe("statistics cohort and current work", () => {
  test("historical blocking reserves honor closure and parent filters", () => {
    const rows = empty();
    rows.pvs = [pv("old", { created_at: "2025-01-01T00:00:00Z" })];
    rows.reserves = [
      "ouverte",
      "en_cours",
      "levee",
      "en_attente_validation",
      "validee",
      "rejetee",
    ].map((status) => ({
      id: status,
      pv_id: "old",
      severity: "bloquante",
      status,
      created_at: "2025-01-01T00:00:00Z",
    }));
    const s = computeStats({ ...input, pvType: "reception", userId }, rows);
    expect(s.today.reservesBlocking).toBe(4);
    expect(s.today.reservesMajor).toBe(0);
    expect(s.kpis.reservesTotal).toBe(0);
    expect(computeStats({ ...input, pvType: "livraison" }, rows).today.reservesBlocking).toBe(0);
    expect(computeStats({ ...input, userId: "other" }, rows).today.reservesBlocking).toBe(0);
  });
  test("three severities exported separately, unknown severity still rejected", async () => {
    const rows = empty();
    rows.reserves = ["mineure", "majeure", "bloquante"].map((severity) => ({
      id: severity,
      pv_id: "a",
      status: "ouverte",
      severity,
      created_at: "2026-03-29T12:00:00Z",
    }));
    const stats = computeStats(input, rows);
    expect(stats.kpis.reservesBySeverity.map((s) => s.value)).toEqual([1, 1, 1]);
    expect(statsExportRows(stats, "Test")).toContainEqual(["Réserves bloquantes non clôturées", 1]);
    expect(statsExportRows(stats, "Test")).toContainEqual(["Bloquantes", 1]);
    expect(buildStatsCsv(stats, "Test")).toContain('"Bloquantes";"1"');
    expect(
      (await PDFDocument.load(await buildStatsPdf(stats, "Test"))).getPageCount(),
    ).toBeGreaterThan(0);
    rows.reserves[0].severity = "inconnue";
    expect(() => computeStats(input, rows)).toThrow("non reconnu");
  });
  test("signed status without timestamp counts as signed but not delay", () => {
    const rows = empty();
    rows.pvs = [pv("a", { status: "signe" })];
    const s = computeStats(input, rows);
    expect(s.kpis.signedPv).toBe(1);
    expect(s.kpis.avgDelayHours).toBeNull();
    expect(s.kpis.signaturesWithoutValidDate).toBe(1);
  });
  test("zero reference has no fictitious benefit", () => {
    const s = computeStats(input, empty());
    expect(s.kpis.signatureRate).toBeNull();
    expect(s.kpis.avgDelayHours).toBeNull();
    expect(countVariation(0, 0)).toBe("Sans référence comparable");
    expect(countVariation(70, 60, true)).toBe("+10 points vs période précédente");
  });
  test("historical parent remains eligible for period resources", () => {
    const rows = empty();
    rows.pvs = [pv("old", { created_at: "2025-01-01T00:00:00Z" })];
    rows.reserves = [
      {
        id: "r",
        pv_id: "old",
        status: "ouverte",
        severity: "majeure",
        created_at: "2026-03-29T12:00:00Z",
      },
    ];
    rows.photos = [{ id: "p", pv_id: "old", created_at: "2026-03-29T12:00:00Z" }];
    rows.emails = [{ id: "e", pv_id: "old", status: "sent", created_at: "2026-03-29T12:00:00Z" }];
    const s = computeStats({ ...input, pvType: "reception", userId }, rows);
    expect(s.kpis.totalPv).toBe(0);
    expect(s.kpis.reservesTotal).toBe(1);
    expect(s.kpis.photosTotal).toBe(1);
    expect(s.kpis.emailsSent).toBe(1);
  });
  test("zero matching parents excludes global emails and actions", () => {
    const rows = empty();
    rows.emails = [{ id: "e", pv_id: null, status: "sent", created_at: "2026-03-29T12:00:00Z" }];
    rows.actions = [
      { id: "a", pv_id: null, user_id: userId, action: "read", created_at: "2026-03-29T12:00:00Z" },
    ];
    const s = computeStats({ ...input, pvType: "livraison" }, rows);
    expect(s.kpis.emailsSent).toBe(0);
    expect(s.activityByUser).toEqual([]);
  });
  test("member means parent creator for email, action author for journal", () => {
    const rows = empty();
    rows.pvs = [pv("other", { owner_id: "other" }), pv("mine")];
    rows.emails = [{ id: "e", pv_id: "other", status: "sent", created_at: "2026-03-29T12:00:00Z" }];
    rows.actions = [
      {
        id: "a",
        pv_id: "other",
        user_id: userId,
        action: "edit",
        created_at: "2026-03-29T12:00:00Z",
      },
      {
        id: "b",
        pv_id: "mine",
        user_id: "other",
        action: "edit",
        created_at: "2026-03-29T12:00:00Z",
      },
    ];
    const s = computeStats({ ...input, userId }, rows);
    expect(s.kpis.emailsSent).toBe(0);
    expect(s.activityByUser[0].count).toBe(1);
  });
  test("pending is outside period, shares sent cutoff, excludes drafts and archives", () => {
    const rows = empty();
    rows.pvs = [
      pv("pending", {
        status: "en_attente",
        created_at: "2025-01-01T00:00:00Z",
        sent_to_client_at: "2026-03-01T00:00:00Z",
      }),
      pv("draft", { sent_to_client_at: "2026-03-01T00:00:00Z" }),
      pv("archive", { status: "archive", sent_to_client_at: "2026-03-01T00:00:00Z" }),
      pv("other", {
        type: "livraison",
        status: "en_attente",
        sent_to_client_at: "2026-03-01T00:00:00Z",
      }),
    ];
    const s = computeStats(
      { ...input, pvType: "reception" },
      rows,
      new Date("2026-03-29T12:00:00Z"),
    );
    expect(s.today.pendingOver7Days).toBe(1);
  });
  test("reserve work honors real major severity and navigation open status", () => {
    const rows = empty();
    rows.reserves = [
      {
        id: "1",
        pv_id: "a",
        status: "ouverte",
        severity: "majeure",
        created_at: "2025-01-01T00:00:00Z",
      },
      {
        id: "2",
        pv_id: "a",
        status: "en_attente_validation",
        severity: "majeure",
        created_at: "2025-01-01T00:00:00Z",
      },
      {
        id: "3",
        pv_id: "a",
        status: "validee",
        severity: "majeure",
        created_at: "2025-01-01T00:00:00Z",
      },
    ];
    const s = computeStats(input, rows);
    expect(s.today).toMatchObject({
      reservesMajor: 2,
      reservesToValidate: 1,
      reservesToProcess: 1,
    });
  });
  test("unknown reserve state fails instead of false zero", () => {
    const rows = empty();
    rows.reserves = [
      {
        id: "r",
        pv_id: "a",
        status: "unknown",
        severity: "majeure",
        created_at: "2026-03-29T12:00:00Z",
      },
    ];
    expect(() => computeStats(input, rows)).toThrow();
  });
});
describe("complete deterministic reads", () => {
  test("reads more than 1000 rows without truncation", async () => {
    const data = Array.from({ length: 1201 }, (_, id) => ({ id }));
    const result = await readComplete(
      (o, n) => Promise.resolve({ data: data.slice(o, o + n), count: data.length, error: null }),
      "PV",
    );
    expect(result.length).toBe(1201);
    expect(result.at(-1)?.id).toBe(1200);
  });
  test("errors and missing exact counts fail closed", async () => {
    await expect(
      readComplete(() => Promise.resolve({ data: [], count: 0, error: new Error() }), "Photos"),
    ).rejects.toThrow();
    await expect(
      readComplete(() => Promise.resolve({ data: [], count: null, error: null }), "Emails"),
    ).rejects.toThrow();
  });
  test("changing and overlarge sets fail explicitly", async () => {
    let count = 0;
    await expect(
      readComplete(
        () => Promise.resolve({ data: [1], count: ++count === 1 ? 2 : 3, error: null }),
        "PV",
      ),
    ).rejects.toThrow("modifiées");
    await expect(
      readComplete(() => Promise.resolve({ data: [], count: 50001, error: null }), "PV"),
    ).rejects.toThrow("trop important");
  });
});
describe("scope and exports", () => {
  test("active billing permits read despite unknown suspension, never export; null access is error", () => {
    expect(
      statsReadState({
        isPending: false,
        isError: false,
        access: { state: "active" },
        blocked: false,
        feature: true,
      }),
    ).toBe("ready");
    expect(canExportStats("directeur", false, true, true)).toBe(false);
    expect(
      statsReadState({
        isPending: false,
        isError: false,
        access: null,
        blocked: false,
        feature: true,
      }),
    ).toBe("error");
  });
  test("new suspension closes export and invalidates late response", () => {
    const scope = createStatsScope();
    scope.set("A:known:true:blocked:false");
    const late = scope.capture();
    scope.set("A:known:true:blocked:true");
    expect(canExportStats("directeur", true, false, true)).toBe(false);
    expect(late()).toBe(false);
  });
  test("A to B to A never revives old export", () => {
    const scope = createStatsScope();
    scope.set("A");
    const late = scope.capture();
    scope.set("B");
    scope.set("A");
    expect(late()).toBe(false);
    expect(scope.capture()()).toBe(true);
  });
  test("refusals and technical errors become useful French messages", () => {
    expect(statsErrorMessage(new Error("COMPANY_SUSPENDED:support"))).toContain(
      "Entreprise suspendue",
    );
    expect(statsErrorMessage(new Error("SUBSCRIPTION_REQUIRED:past_due"))).toContain(
      "administrateur",
    );
    expect(statsErrorMessage(new Error("Failed to fetch"))).toContain("Réessayez");
    expect(statsErrorMessage(new Error("PGRST301"))).not.toContain("PGRST");
  });
  test("PDF upload failure cannot sign or report success", async () => {
    let signed = false;
    await expect(
      persistStatsPdf(
        () => Promise.resolve({ error: new Error("storage") }),
        () => {
          signed = true;
          return Promise.resolve({ error: null, data: { signedUrl: "unused" } });
        },
      ),
    ).rejects.toThrow("enregistré");
    expect(signed).toBe(false);
  });
  test("signed URL failure cannot return PDF success", async () => {
    await expect(
      persistStatsPdf(
        () => Promise.resolve({ error: null }),
        () => Promise.resolve({ error: new Error("sign"), data: null }),
      ),
    ).rejects.toThrow("lien");
  });
  test("export only SIGN roles with known feature and loaded scope", () => {
    for (const role of ["directeur", "responsable_exploitation", "conducteur_travaux"])
      expect(canExportStats(role, true, true, true)).toBe(true);
    for (const role of ["assistant_admin", "technicien", "lecture_seule", "fake"])
      expect(canExportStats(role, true, true, true)).toBe(false);
    expect(canExportStats("directeur", false, true, true)).toBe(false);
    expect(canExportStats("directeur", true, false, true)).toBe(false);
    expect(canExportStats("directeur", true, true, false)).toBe(false);
  });
  test("A response cannot apply after switch to B or disposal", () => {
    const scope = createStatsScope();
    scope.set("A");
    const accept = scope.begin();
    expect(accept()).toBe(true);
    const exportAccept = scope.capture();
    scope.set("B");
    expect(accept()).toBe(false);
    expect(exportAccept()).toBe(false);
    const b = scope.begin();
    scope.dispose();
    expect(b()).toBe(false);
  });
  test("CSV is French Excel-safe and compares only when requested", () => {
    const stats = computeStats({ ...input, compare: false }, empty());
    const csv = buildStatsCsv(stats, '=HYPERLINK("bad")');
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"\'=HYPERLINK(""bad"")"');
    expect(csv).toContain(";");
    expect(statsExportRows(stats, "PVIA").find((r) => r[0] === "Indicateur")?.length).toBe(2);
    expect(statsCsvCell(" \t+1")).toContain("'");
  });
  test("real PDF generator handles French punctuation and multi-page long identities", async () => {
    const rows = empty();
    rows.members = Array.from({ length: 80 }, (_, i) => ({
      user_id: String(i),
      name: "Élodie — Très longue identité française ".repeat(6),
    }));
    rows.actions = rows.members.map((m, i) => ({
      id: String(i),
      user_id: m.user_id,
      pv_id: null,
      action: "read",
      created_at: "2026-03-29T12:00:00Z",
    }));
    const bytes = await buildStatsPdf(
      computeStats({ ...input, compare: false }, rows),
      "Société d’installation française",
    );
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(2);
  });
});

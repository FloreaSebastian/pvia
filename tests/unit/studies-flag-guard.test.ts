import { describe, expect, test, afterEach } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { assertSolarManage, assertSolarMember } from "@/lib/solar.server";
import { MODULE_UNAVAILABLE_MESSAGE, setFeatureFlagForTests, FEATURE_FLAGS } from "@/lib/feature-flags";
import { createAutosaveQueue } from "@/lib/visites/autosave-queue";

const CO = "00000000-0000-4000-8000-000000000001";
const U = "00000000-0000-4000-8000-000000000002";
function fakeSb() {
  const calls: string[] = [];
  const sb = { rpc: async (name: string) => (calls.push(name), { data: true, error: null }) } as any;
  return { sb, calls };
}

afterEach(() => setFeatureFlagForTests("studies", undefined));

describe("flag studies — gardes serveur Solar", () => {
  test("le module est masqué par défaut", () => {
    expect(FEATURE_FLAGS.studies).toBe(false);
  });
  test("module désactivé : lecture refusée avant toute requête", async () => {
    setFeatureFlagForTests("studies", false);
    const { sb, calls } = fakeSb();
    await expect(assertSolarMember(sb, CO, U)).rejects.toThrow(MODULE_UNAVAILABLE_MESSAGE);
    expect(calls).toEqual([]);
  });
  test("module désactivé : écriture refusée avant toute requête", async () => {
    setFeatureFlagForTests("studies", false);
    const { sb, calls } = fakeSb();
    await expect(assertSolarManage(sb, CO, U)).rejects.toThrow(MODULE_UNAVAILABLE_MESSAGE);
    expect(calls).toEqual([]);
  });
  test("réactivation : le contrôle de membre reprend normalement", async () => {
    setFeatureFlagForTests("studies", true);
    const { sb, calls } = fakeSb();
    await expect(assertSolarMember(sb, CO, U)).resolves.toBeUndefined();
    expect(calls).toEqual(["is_company_member"]);
  });
  test("réactivation : un non-membre reste refusé", async () => {
    setFeatureFlagForTests("studies", true);
    const sb = { rpc: async () => ({ data: false, error: null }) } as any;
    await expect(assertSolarMember(sb, CO, U)).rejects.toThrow("Accès refusé.");
  });
  test("chaque fonction serveur Solar passe par une garde centrale", () => {
    const files = readdirSync("src/lib").filter((f) => /^solar.*\.functions\.ts$/.test(f));
    expect(files.length).toBeGreaterThanOrEqual(8);
    for (const f of files) {
      const src = readFileSync(`src/lib/${f}`, "utf8");
      const blocks = src.split(/createServerFn\(/).slice(1);
      for (const b of blocks) {
        expect({ f, guarded: /assertSolarMember|assertSolarManage|assertFeatureEnabled\("studies"\)/.test(b) }).toEqual({ f, guarded: true });
      }
    }
  });
});

describe("autosave — saisie pendant un envoi lent", () => {
  test("la saisie arrivée pendant l'envoi part automatiquement après, sans nouvelle frappe", async () => {
    const pending = new Map<string, string>([["a", "1"]]);
    const sent: string[][] = [];
    let release!: () => void;
    let first = true;
    const q = createAutosaveQueue({
      hasPending: () => pending.size > 0,
      send: async () => {
        const snap = [...pending.keys()];
        sent.push(snap);
        if (first) { first = false; await new Promise<void>((r) => (release = r)); }
        snap.forEach((k) => pending.delete(k));
        return true;
      },
    });
    const p = q.flush();
    await Promise.resolve();
    pending.set("b", "2"); // saisie pendant l'envoi lent, aucun nouveau flush
    release();
    expect(await p).toBe(true);
    expect(sent).toEqual([["a"], ["b"]]);
    expect(pending.size).toBe(0);
  });
  test("un échec arrête la boucle et conserve la file", async () => {
    const pending = new Map([["a", "1"]]);
    let n = 0;
    const q = createAutosaveQueue({ hasPending: () => pending.size > 0, send: async () => (n++, false) });
    expect(await q.flush()).toBe(false);
    expect(n).toBe(1);
    expect(pending.size).toBe(1);
  });
  test("deux demandes simultanées ne lancent pas deux envois parallèles", async () => {
    let active = 0, max = 0;
    const pending = new Map([["a", "1"]]);
    const q = createAutosaveQueue({
      hasPending: () => pending.size > 0,
      send: async () => { active++; max = Math.max(max, active); await new Promise((r) => setTimeout(r, 5)); pending.clear(); active--; return true; },
    });
    await Promise.all([q.flush(), q.flush(), q.flush()]);
    expect(max).toBe(1);
  });
});

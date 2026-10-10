import { describe, it, expect, vi } from "vitest";
import { authorizePvCreate, type PvCreateGateDeps } from "@/lib/pv-create-access";
import { createScopeGuard } from "@/lib/scope-guard";

const CO = "co-a";
function deps(
  member: { role: string; status: string } | null,
  parents: Record<string, string> = {},
) {
  const effects = { insert: vi.fn(), upload: vi.fn(), notify: vi.fn(), pdf: vi.fn() };
  const d: PvCreateGateDeps = {
    getMember: async () => member,
    parentInCompany: async (_t, id, companyId) => parents[id] === companyId,
  };
  return { d, effects };
}
// Simule l'ordre du handler réel : garde puis effets.
async function run(
  d: PvCreateGateDeps,
  effects: ReturnType<typeof deps>["effects"],
  input: Parameters<typeof authorizePvCreate>[1],
) {
  await authorizePvCreate(d, input, "u1");
  effects.insert();
  effects.upload();
  effects.notify();
  effects.pdf();
}
const none = (e: ReturnType<typeof deps>["effects"]) =>
  [e.insert, e.upload, e.notify, e.pdf].every((f) => f.mock.calls.length === 0);

describe("createPv — garde d'accès avant tout effet", () => {
  it("lecture seule refusée, aucun effet", async () => {
    const { d, effects } = deps({ role: "lecture_seule", status: "active" });
    await expect(run(d, effects, { companyId: CO, status: "brouillon" })).rejects.toMatchObject({
      code: "ROLE_REQUIRED",
    });
    expect(none(effects)).toBe(true);
  });
  it("technicien refusé", async () => {
    const { d, effects } = deps({ role: "technicien", status: "active" });
    await expect(run(d, effects, { companyId: CO, status: "brouillon" })).rejects.toMatchObject({
      code: "ROLE_REQUIRED",
    });
    expect(none(effects)).toBe(true);
  });
  it("membre suspendu ou absent refusé", async () => {
    for (const m of [{ role: "directeur", status: "suspended" }, null]) {
      const { d, effects } = deps(m);
      await expect(run(d, effects, { companyId: CO, status: "brouillon" })).rejects.toMatchObject({
        code: "NOT_MEMBER",
      });
      expect(none(effects)).toBe(true);
    }
  });
  it("assistant : brouillon autorisé", async () => {
    const { d, effects } = deps({ role: "assistant_admin", status: "active" }, { c1: CO });
    await run(d, effects, { companyId: CO, status: "brouillon", client_id: "c1" });
    expect(effects.insert).toHaveBeenCalledTimes(1);
  });
  it("assistant : signature, envoi, OTP ou réserve finalisée refusés même en brouillon", async () => {
    const cases = [
      { status: "signe" as const },
      { status: "en_attente" as const },
      { status: "brouillon" as const, company_signature: "data:x" },
      { status: "brouillon" as const, client_signature: "data:x" },
      { status: "brouillon" as const, client_otp_id: "otp" },
      { status: "brouillon" as const, reserves: [{ status: "validee" }] },
      { status: "brouillon" as const, reserves: [{ status: "levee" }] },
    ];
    for (const c of cases) {
      const { d, effects } = deps({ role: "assistant_admin", status: "active" });
      await expect(run(d, effects, { companyId: CO, ...c })).rejects.toMatchObject({
        code: "SIGN_ROLE_REQUIRED",
      });
      expect(none(effects)).toBe(true);
    }
  });
  it("conducteur peut signer", async () => {
    const { d, effects } = deps({ role: "conducteur_travaux", status: "active" });
    await run(d, effects, { companyId: CO, status: "signe", company_signature: "data:x" });
    expect(effects.insert).toHaveBeenCalledTimes(1);
  });
  it("client ou chantier d'une autre entreprise refusé", async () => {
    for (const k of ["client_id", "chantier_id"] as const) {
      const { d, effects } = deps({ role: "directeur", status: "active" }, { x: "co-b" });
      await expect(
        run(d, effects, { companyId: CO, status: "brouillon", [k]: "x" }),
      ).rejects.toMatchObject({ code: "PARENT_TENANT" });
      expect(none(effects)).toBe(true);
    }
  });
  it("rôle runtime inconnu refusé", async () => {
    const { d, effects } = deps({ role: "superadmin", status: "active" });
    await expect(run(d, effects, { companyId: CO, status: "brouillon" })).rejects.toMatchObject({
      code: "ROLE_REQUIRED",
    });
  });
});

describe("Équipe — suite de mutation tardive après changement d'entreprise", () => {
  it("la suite de la mutation A ne recharge ni n'affiche A sous B", async () => {
    const shown: string[] = [];
    let release!: () => void;
    const scopeA = createScopeGuard();
    const mutationA = (async () => {
      await new Promise<void>((r) => (release = r));
      if (!scopeA.alive()) return;
      const t = scopeA.next();
      if (scopeA.isCurrent(t)) shown.push("A");
    })();
    // Changement d'entreprise : la portée A est close (remontage par clé).
    scopeA.dispose();
    const scopeB = createScopeGuard();
    const tb = scopeB.next();
    if (scopeB.isCurrent(tb)) shown.push("B");
    release();
    await mutationA;
    expect(shown).toEqual(["B"]);
  });
  it("un chargement dépassé dans la même portée est ignoré", () => {
    const g = createScopeGuard();
    const t1 = g.next();
    const t2 = g.next();
    expect(g.isCurrent(t1)).toBe(false);
    expect(g.isCurrent(t2)).toBe(true);
  });
});

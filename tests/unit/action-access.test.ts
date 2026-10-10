import { describe, it, expect, mock } from "bun:test";
import { authorizeCompanyAction, type ActionAccessDeps } from "@/lib/action-access";

function setup(member: { role: string; status: string } | null, writeOk = true) {
  const effect = mock(() => {});
  const assertWriteAccess = mock(async () => {
    if (!writeOk) throw new Error("SUSPENDED");
  });
  const deps: ActionAccessDeps = { getMember: async () => member, assertWriteAccess };
  const run = async (need: "manage" | "sign") => {
    await authorizeCompanyAction(deps, "co", "u", need);
    effect();
  };
  return { run, effect, assertWriteAccess };
}

describe("Régénération PDF (manage) et relances de levée (sign) : garde avant effet", () => {
  it("lecture seule, technicien, inactif, absent : refus sans effet", async () => {
    for (const m of [
      { role: "lecture_seule", status: "active" },
      { role: "technicien", status: "active" },
      { role: "directeur", status: "suspended" },
      null,
    ]) {
      const t = setup(m);
      await expect(t.run("manage")).rejects.toBeDefined();
      expect(t.effect).not.toHaveBeenCalled();
    }
  });
  it("entreprise suspendue / sans accès écriture : refus sans effet", async () => {
    const t = setup({ role: "directeur", status: "active" }, false);
    await expect(t.run("manage")).rejects.toThrow("SUSPENDED");
    expect(t.effect).not.toHaveBeenCalled();
  });
  it("assistant : régénération autorisée, relance de signature refusée", async () => {
    const ok = setup({ role: "assistant_admin", status: "active" });
    await ok.run("manage");
    expect(ok.effect).toHaveBeenCalledTimes(1);
    const ko = setup({ role: "assistant_admin", status: "active" });
    await expect(ko.run("sign")).rejects.toMatchObject({ code: "ROLE_REQUIRED" });
    expect(ko.effect).not.toHaveBeenCalled();
    expect(ko.assertWriteAccess).not.toHaveBeenCalled();
  });
  it("conducteur : relance de signature autorisée après contrôle d'accès écriture", async () => {
    const t = setup({ role: "conducteur_travaux", status: "active" });
    await t.run("sign");
    expect(t.assertWriteAccess).toHaveBeenCalledTimes(1);
    expect(t.effect).toHaveBeenCalledTimes(1);
  });
});

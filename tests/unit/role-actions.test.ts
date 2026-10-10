import { describe, it, expect } from "bun:test";
import { roleCapabilities, canEnterVisitField } from "@/lib/role-access";

const open = { writeOpen: true };
const v = (assigned_to: string | null, status = "en_cours") => ({ assigned_to, status });

describe("Saisie terrain depuis la liste des visites", () => {
  it("technicien affecté : oui ; non affecté : non", () => {
    const c = roleCapabilities("technicien", open);
    expect(canEnterVisitField(c, "technicien", "u1", v("u1"), true)).toBe(true);
    expect(canEnterVisitField(c, "technicien", "u1", v("u2"), true)).toBe(false);
    expect(canEnterVisitField(c, "technicien", "u1", v(null), true)).toBe(false);
  });
  it("lecture seule affectée : non", () => {
    const c = roleCapabilities("lecture_seule", open);
    expect(canEnterVisitField(c, "lecture_seule", "u1", v("u1"), true)).toBe(false);
  });
  it("gestionnaire : oui sur toute visite non figée", () => {
    const c = roleCapabilities("assistant_admin", open);
    expect(canEnterVisitField(c, "assistant_admin", "u9", v("u2"), true)).toBe(true);
    expect(canEnterVisitField(c, "assistant_admin", "u9", v("u2", "validee"), true)).toBe(false);
  });
  it("écriture inconnue ou fonctionnalité absente : non", () => {
    const closed = roleCapabilities("directeur", { writeOpen: false });
    expect(canEnterVisitField(closed, "directeur", "u1", v("u1"), true)).toBe(false);
    const c = roleCapabilities("directeur", open);
    expect(canEnterVisitField(c, "directeur", "u1", v("u1"), false)).toBe(false);
  });
});

describe("Actions PV / réserves par rôle", () => {
  it("assistant : gestion (brouillon, relance) sans signature ni levée", () => {
    const c = roleCapabilities("assistant_admin", open);
    expect(c.manage).toBe(true);
    expect(c.sign).toBe(false);
  });
  it("conducteur : signature et levée", () => {
    const c = roleCapabilities("conducteur_travaux", open);
    expect(c.sign).toBe(true);
  });
  it("technicien et lecture seule : ni création ni signature", () => {
    for (const r of ["technicien", "lecture_seule"]) {
      const c = roleCapabilities(r, open);
      expect(c.manage).toBe(false);
      expect(c.sign).toBe(false);
    }
  });
  it("accès écriture non confirmé : tout fermé, même directeur", () => {
    const c = roleCapabilities("directeur", { writeOpen: false });
    expect(c.manage).toBe(false);
    expect(c.sign).toBe(false);
  });
});

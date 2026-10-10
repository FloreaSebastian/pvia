import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  ROLE_PROFILES,
  allowedSettings,
  mobileDestinations,
  roleCapabilities,
  roleShortcuts,
} from "@/lib/role-access";
import { ROLE_ORDER, type CompanyRoleValue } from "@/lib/roles";

const open = { writeOpen: true };
const closed = { writeOpen: false };

describe("capacités par rôle (alignées serveur)", () => {
  const expected: Record<
    CompanyRoleValue,
    { manage: boolean; sign: boolean; terrain: boolean; admin: boolean; owner: boolean }
  > = {
    directeur: { manage: true, sign: true, terrain: true, admin: true, owner: true },
    responsable_exploitation: {
      manage: true,
      sign: true,
      terrain: true,
      admin: true,
      owner: false,
    },
    conducteur_travaux: { manage: true, sign: true, terrain: true, admin: false, owner: false },
    assistant_admin: { manage: true, sign: false, terrain: true, admin: false, owner: false },
    technicien: { manage: false, sign: false, terrain: true, admin: false, owner: false },
    lecture_seule: { manage: false, sign: false, terrain: false, admin: false, owner: false },
  };
  for (const role of ROLE_ORDER) {
    test(role, () => {
      const c = roleCapabilities(role, open);
      const e = expected[role];
      expect([c.manage, c.sign, c.terrainAssigned, c.admin, c.owner]).toEqual([
        e.manage,
        e.sign,
        e.terrain,
        e.admin,
        e.owner,
      ]);
      expect(c.billing).toBe(e.admin);
    });
  }
  test("lecture seule ne peut jamais saisir une visite, même affectée", () => {
    expect(roleCapabilities("lecture_seule", open).terrainAssigned).toBe(false);
  });
  test("accès inconnu/erreur/suspendu : aucune écriture", () => {
    for (const role of ROLE_ORDER) {
      const c = roleCapabilities(role, closed);
      expect([c.manage, c.sign, c.terrainAssigned]).toEqual([false, false, false]);
    }
    const none = roleCapabilities(null, open);
    expect([none.manage, none.sign, none.terrainAssigned, none.admin, none.billing]).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });
  test("le directeur n'obtient aucun droit plateforme", () => {
    expect(Object.keys(roleCapabilities("directeur", open))).not.toContain("platformAdmin");
  });
});

describe("paramètres : liste unique autorisée", () => {
  const admin = [
    "/entreprise",
    "/equipe",
    "/billing",
    "/parametres/integrations",
    "/parametres/api",
  ];
  test("administrateurs voient l'organisation", () => {
    for (const r of ["directeur", "responsable_exploitation"] as const) {
      const to = allowedSettings(r).map((e) => e.to);
      for (const a of admin) expect(to).toContain(a);
    }
  });
  test("autres rôles : compte personnel + consultations, sans pages réservées", () => {
    for (const r of [
      "conducteur_travaux",
      "technicien",
      "assistant_admin",
      "lecture_seule",
    ] as const) {
      const to = allowedSettings(r).map((e) => e.to);
      for (const a of admin) expect(to).not.toContain(a);
      expect(to).toContain("/parametres");
      expect(to).toContain("/parametres/numerotation");
    }
  });
  test("rôle inconnu : pas d'organisation", () => {
    expect(allowedSettings(null).some((e) => e.access === "admin")).toBe(false);
  });
});

describe("navigation mobile", () => {
  test("au plus 3 destinations de rôle (+ Accueil + Menu = 5)", () => {
    for (const r of ROLE_ORDER) {
      const d = mobileDestinations(r, { canVisit: true });
      expect(d.length).toBeLessThanOrEqual(3);
      expect(new Set(d).size).toBe(d.length);
    }
  });
  test("sans module visites, aucune destination Visites", () => {
    for (const r of ROLE_ORDER)
      expect(mobileDestinations(r, { canVisit: false })).not.toContain("visites");
  });
  test("technicien : visites en premier", () => {
    expect(mobileDestinations("technicien", { canVisit: true })[0]).toBe("visites");
  });
});

describe("vues par rôle", () => {
  test("chaque rôle a un ordre distinct de blocs ou de priorités", () => {
    const sigs = ROLE_ORDER.map((r) =>
      JSON.stringify([
        ROLE_PROFILES[r].order,
        ROLE_PROFILES[r].planningFirst,
        ROLE_PROFILES[r].mobile,
      ]),
    );
    expect(new Set(sigs).size).toBe(ROLE_ORDER.length);
  });
  test("technicien : visites affectées en premier", () => {
    expect(ROLE_PROFILES.technicien.order[0]).toBe("visits");
  });
  test("raccourcis : équipe seulement pour administrateurs", () => {
    for (const r of ROLE_ORDER) {
      const hasTeam = roleShortcuts(r).some((s) => s.to === "/equipe");
      expect(hasTeam).toBe(r === "directeur" || r === "responsable_exploitation");
    }
  });
});

describe("source serveur visites", () => {
  test("migration : édition affectée exclut lecture_seule", () => {
    const sql = readFileSync("drizzle/migrations/0009_visit_edit_excludes_read_only.sql", "utf8");
    expect(sql).toContain("role <> 'lecture_seule'");
    expect(sql).toContain("is_company_field_member(v.company_id, _user_id)");
  });
});

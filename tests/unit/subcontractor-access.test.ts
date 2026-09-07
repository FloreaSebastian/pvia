import { describe, expect, it } from "bun:test";
import {
  PRESETS,
  SUBCONTRACTOR_PERMISSIONS,
  effectivePermissions,
  hasPermission,
  maskChantier,
  maskClientContact,
  mapWorkspaceAssignment,
  normalizePermissionOverrides,
  normalizePermissions,
  permissionsFromPreset,
} from "../../src/lib/subcontractor-permissions";
import { matchesAudience } from "../../src/lib/auth-code-audience";
import { ADMIN_ROLES, OWNER_ROLES, isAdminRole } from "../../src/lib/roles";

describe("rôles internes autorisés à administrer les sous-traitants", () => {
  it("seuls directeur (owner) et responsable_exploitation (admin) sont admin", () => {
    expect([...ADMIN_ROLES]).toEqual(["directeur", "responsable_exploitation"]);
    expect([...OWNER_ROLES]).toEqual(["directeur"]);
    for (const role of ["conducteur_travaux", "technicien", "assistant_admin", "lecture_seule"]) {
      expect(isAdminRole(role)).toBe(false);
    }
  });
});

describe("presets sous-traitant", () => {
  it("aucun preset ne donne un droit inconnu", () => {
    for (const list of Object.values(PRESETS)) {
      for (const p of list) expect(SUBCONTRACTOR_PERMISSIONS).toContain(p);
    }
  });

  it("Terrain n'accède ni aux réserves, ni aux visites, ni au contact client", () => {
    const t = permissionsFromPreset("terrain");
    expect(hasPermission(t, "reserve.view")).toBe(false);
    expect(hasPermission(t, "visit.fill")).toBe(false);
    expect(hasPermission(t, "client.contact.view")).toBe(false);
    expect(hasPermission(t, "chantier.documents.upload")).toBe(false);
  });

  it("Visite technique ajoute uniquement les droits de visite", () => {
    const v = permissionsFromPreset("visite_technique");
    expect(hasPermission(v, "visit.view")).toBe(true);
    expect(hasPermission(v, "visit.fill")).toBe(true);
    expect(hasPermission(v, "reserve.lift_propose")).toBe(false);
  });

  it("Chef d'équipe reste un externe : aucun droit d'administration", () => {
    const c = permissionsFromPreset("chef_equipe");
    // rien qui ressemble à un droit interne (équipe, facturation, suppression…)
    for (const key of Object.keys(c)) {
      expect(SUBCONTRACTOR_PERMISSIONS).toContain(key as never);
      expect(key).not.toMatch(/(billing|team|member|delete|admin|export)/);
    }
    expect(hasPermission(c, "reserve.lift_propose")).toBe(true);
    // proposer une levée n'est pas la valider
    expect(SUBCONTRACTOR_PERMISSIONS).not.toContain("reserve.lift_validate" as never);
  });

  it("Personnalisé ne donne aucun droit implicite", () => {
    expect(permissionsFromPreset("custom")).toEqual({});
  });
});

describe("permissions stockées : le nom du preset ne donne aucun droit", () => {
  it("ignore toute clé inconnue ou valeur non booléenne", () => {
    const p = normalizePermissions({
      "chantier.view": true,
      "admin.everything": true,
      "chantier.photos.add": "true",
      preset: "chef_equipe",
    });
    expect(p).toEqual({ "chantier.view": true });
  });

  it("une surcharge d'affectation à false retire toujours le droit", () => {
    const base = permissionsFromPreset("chef_equipe");
    const eff = effectivePermissions(base, { "chantier.photos.add": false });
    expect(hasPermission(eff, "chantier.photos.add")).toBe(false);
    expect(hasPermission(eff, "chantier.photos.view")).toBe(true);
  });

  it("une surcharge à true n'ajoute qu'une permission connue", () => {
    const eff = effectivePermissions({ "chantier.view": true }, { "admin.all": true });
    expect(eff).toEqual({ "chantier.view": true });
  });
});

describe("masquage serveur des données", () => {
  const chantier = {
    id: "c1",
    reference: "CH0001AA",
    name: "Dumas",
    status: "en_cours",
    city: "Lyon",
    postal_code: "69003",
    address: "12 rue des Lilas",
    description: "Rénovation complète",
  };

  it("sans chantier.details, adresse et description ne sont pas renvoyées", () => {
    const masked = maskChantier(chantier, { "chantier.view": true });
    expect(masked?.address).toBeNull();
    expect(masked?.description).toBeNull();
    expect(masked?.reference).toBe("CH0001AA");
    expect(JSON.stringify(masked)).not.toContain("Lilas");
  });

  it("avec chantier.details, les informations d'intervention sont renvoyées", () => {
    const masked = maskChantier(chantier, { "chantier.view": true, "chantier.details": true });
    expect(masked?.address).toBe("12 rue des Lilas");
  });

  it("sans client.contact.view, aucune donnée client n'est renvoyée", () => {
    const c = { name: "SCI Dumas", phone: "0612345678", email: "a@b.fr" };
    expect(maskClientContact(c, { "chantier.view": true })).toBeNull();
    const allowed = maskClientContact(c, { "client.contact.view": true });
    expect(allowed).toEqual({ name: "SCI Dumas", phone: "0612345678" });
    expect(JSON.stringify(allowed)).not.toContain("a@b.fr");
  });
});

// ---------------------------------------------------------------------------
// Non-régression : correctifs du 07/09/2026 (workspace, overrides, OTP)
// ---------------------------------------------------------------------------

describe("workspace : masquage du chantier", () => {
  const row = {
    permission_overrides: {},
    chantiers: {
      id: "c1",
      reference: "CH0001AA",
      name: "Chantier test",
      address: "12 rue Secrète",
      city: "Paris",
      postal_code: "75001",
      description: "Note interne",
    },
  };

  it("sans chantier.details, aucune adresse ni description n'est renvoyée", () => {
    const { chantier } = mapWorkspaceAssignment(row, { "chantier.view": true });
    expect(chantier).toBeTruthy();
    expect(chantier!.address ?? null).toBeNull();
    expect((chantier as Record<string, unknown>)["description"] ?? null).toBeNull();
    expect(JSON.stringify(chantier)).not.toContain("rue Secrète");
    expect(JSON.stringify(chantier)).not.toContain("Note interne");
  });

  it("avec chantier.details, l'adresse est renvoyée", () => {
    const { chantier } = mapWorkspaceAssignment(row, {
      "chantier.view": true,
      "chantier.details": true,
    });
    expect(chantier!.address).toBe("12 rue Secrète");
  });

  it("une surcharge false retire l'adresse même si la relation l'accorde", () => {
    const { chantier } = mapWorkspaceAssignment(
      { ...row, permission_overrides: { "chantier.details": false } },
      { "chantier.view": true, "chantier.details": true },
    );
    expect(chantier!.address ?? null).toBeNull();
  });
});

describe("normalizePermissionOverrides", () => {
  it("conserve true ET false", () => {
    const out = normalizePermissionOverrides({
      "chantier.details": false,
      "photo.create": true,
    });
    expect(out["chantier.details"]).toBe(false);
    expect(out["photo.create"]).toBe(true);
  });

  it("ignore les clés inconnues et les valeurs non booléennes", () => {
    const out = normalizePermissionOverrides({
      "company.billing": true,
      "team.manage": false,
      "chantier.view": "yes",
      "photo.view": 1,
    } as unknown);
    expect(Object.keys(out)).toEqual([]);
  });

  it("un false persisté retire réellement le droit hérité", () => {
    const persisted = normalizePermissionOverrides({ "chantier.details": false });
    const eff = effectivePermissions(
      { "chantier.view": true, "chantier.details": true },
      persisted,
    );
    expect(eff["chantier.details"]).toBeFalsy();
    expect(eff["chantier.view"]).toBe(true);
  });
});

describe("séparation des codes de connexion (audience)", () => {
  it("un code professionnel est refusé dans le parcours sous-traitant", () => {
    expect(matchesAudience({ audience: "professional" }, "subcontractor")).toBe(false);
  });

  it("un code sous-traitant est refusé dans le parcours professionnel", () => {
    expect(matchesAudience({ audience: "subcontractor" }, "professional")).toBe(false);
  });

  it("chaque code reste valide dans son propre contexte", () => {
    expect(matchesAudience({ audience: "professional" }, "professional")).toBe(true);
    expect(matchesAudience({ audience: "subcontractor" }, "subcontractor")).toBe(true);
  });

  it("les codes historiques sans contexte restent professionnels", () => {
    expect(matchesAudience({ audience: null }, "professional")).toBe(true);
    expect(matchesAudience({}, "subcontractor")).toBe(false);
  });
});

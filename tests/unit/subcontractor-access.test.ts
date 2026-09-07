import { describe, expect, it } from "bun:test";
import {
  PRESETS,
  SUBCONTRACTOR_PERMISSIONS,
  effectivePermissions,
  hasPermission,
  maskChantier,
  maskClientContact,
  normalizePermissions,
  permissionsFromPreset,
} from "../../src/lib/subcontractor-permissions";
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

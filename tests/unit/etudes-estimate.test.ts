import { describe, expect, it } from "bun:test";
import { computeStudyEstimate, ESTIMATE_DISCLAIMER } from "@/lib/etudes/estimate";
import { STUDY_TEMPLATES, getStudyTemplate, isStudyType, STUDY_TYPE_OPTIONS } from "@/lib/etudes/templates";
import { resolveSections, computeProgress } from "@/lib/visites/engine";
import type { VisitTemplate } from "@/lib/visites/types";
import { STUDY_STATUS_META, STUDY_TYPES } from "@/lib/etudes/types";

const asVisitTemplate = (t: unknown) => t as unknown as VisitTemplate;

describe("catalogue des cahiers des charges", () => {
  it("expose un template par métier, avec sections et clés uniques", () => {
    expect(STUDY_TYPES.length).toBe(3);
    for (const type of STUDY_TYPES) {
      const t = getStudyTemplate(type);
      expect(t.sections.length).toBeGreaterThan(0);
      const keys = t.sections.flatMap((s) => s.fields.map((f) => f.key));
      expect(new Set(keys).size).toBe(keys.length);
    }
    expect(STUDY_TYPE_OPTIONS.length).toBe(3);
    expect(Object.keys(STUDY_TEMPLATES).sort()).toEqual([...STUDY_TYPES].sort());
  });

  it("rejette un métier inconnu", () => {
    expect(isStudyType("photovoltaique")).toBe(true);
    expect(isStudyType("eolien")).toBe(false);
  });

  it("décrit chaque statut du cycle de vie", () => {
    for (const s of ["draft", "in_progress", "internal_review", "completed", "sent", "accepted", "refused", "archived"] as const) {
      expect(STUDY_STATUS_META[s].label.length).toBeGreaterThan(0);
    }
  });
});

describe("estimation indicative", () => {
  it("ne calcule rien sans données et signale les manques", () => {
    const e = computeStudyEstimate("photovoltaique", {});
    expect(e.headline).toBeNull();
    expect(e.missing.length).toBeGreaterThan(0);
    expect(ESTIMATE_DISCLAIMER).toContain("indicative");
  });

  it("produit une puissance photovoltaïque bornée par la toiture exploitable", () => {
    const base = { consommation_annuelle: 20000, orientation: "sud", ombrage: "aucun", objectif: "vente_totale" };
    const small = computeStudyEstimate("photovoltaique", { ...base, surface_disponible: 20 });
    const large = computeStudyEstimate("photovoltaique", { ...base, surface_disponible: 120 });
    expect(small.headline).not.toBeNull();
    expect(large.headline).not.toBeNull();
    expect(small.items.length).toBeGreaterThan(0);
    expect(small.headline!.value).not.toBe(large.headline!.value);
  });

  it("signale l'ombrage fort et l'amiante comme points de vigilance", () => {
    const e = computeStudyEstimate("photovoltaique", {
      surface_disponible: 60,
      consommation_annuelle: 9000,
      orientation: "sud",
      ombrage: "fort",
      amiante_suspecte: "oui",
    });
    expect(e.warnings.join(" ")).toContain("Ombrage fort");
    expect(e.warnings.join(" ")).toContain("Amiante");
  });

  it("dimensionne une PAC air/eau selon la surface et la zone climatique", () => {
    const h1 = computeStudyEstimate("pac_air_eau", { surface_chauffee: 120, zone_climatique: "h1", isolation: "moyenne" });
    const h3 = computeStudyEstimate("pac_air_eau", { surface_chauffee: 120, zone_climatique: "h3", isolation: "moyenne" });
    expect(h1.headline).not.toBeNull();
    expect(h3.headline).not.toBeNull();
    expect(h1.headline!.value).not.toBe(h3.headline!.value);
  });

  it("ne renvoie jamais de valeur présentée comme contractuelle", () => {
    const e = computeStudyEstimate("pac_air_air", { nb_pieces: 3, surface_chauffee: 80, zone_climatique: "h2" });
    const text = JSON.stringify(e).toLowerCase();
    expect(text).not.toContain("devis");
    expect(Array.isArray(e.warnings)).toBe(true);
  });
});

describe("moteur de questionnaire réutilisé", () => {
  it("réutilise le moteur des visites pour la complétude", () => {
    const template = asVisitTemplate(getStudyTemplate("photovoltaique"));
    const sections = resolveSections(template, {});
    expect(sections.length).toBeGreaterThan(0);

    const empty = computeProgress(template, { answers: {}, photoSlots: new Set(), skippedSlots: new Set() });
    expect(empty.percent).toBe(0);
    expect(empty.canComplete).toBe(false);
  });

  it("déplie les blocs répétables PAC air/air selon le nombre de pièces", () => {
    const template = asVisitTemplate(getStudyTemplate("pac_air_air"));
    const one = resolveSections(template, { nb_pieces: 1 });
    const three = resolveSections(template, { nb_pieces: 3 });
    const blocks = (list: ReturnType<typeof resolveSections>) =>
      list.reduce((n, s) => n + s.blocks.length, 0);
    expect(blocks(three)).toBeGreaterThan(blocks(one));
  });
});

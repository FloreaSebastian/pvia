import { describe, expect, it } from "bun:test";
import { composeBtpTemplate, normalizeLots, resolveVisitTemplate, PHOTOVOLTAIQUE_TEMPLATE } from "../../src/lib/visites/templates";
import { computeProgress, formatAnswer, resolveSections } from "../../src/lib/visites/engine";
import { findTemplateField, findTemplateSlot, validateAnswerEntries, validateFieldValue } from "../../src/lib/visites/validation";
import { CreateVisitSchema } from "../../src/lib/visites/schemas";
import { VISIT_LOTS } from "../../src/lib/visites/types";

const empty = { photoSlots: new Set<string>(), skippedSlots: new Set<string>(), constraintCount: 0 };

describe("visite BTP multi-lots", () => {
  it("dossier historique PV : template inchangé, sans statuts Inconnu/N/A", () => {
    expect(resolveVisitTemplate({ visit_type: "photovoltaique", lots: [] })).toBe(PHOTOVOLTAIQUE_TEMPLATE);
    const hit = findTemplateField(PHOTOVOLTAIQUE_TEMPLATE, "batiment_type")!;
    expect(validateFieldValue(hit.field, "__non_applicable")).not.toBeNull();
    expect(validateAnswerEntries(PHOTOVOLTAIQUE_TEMPLATE, [{ section_key: "general", field_key: "batiment_type", value: "maison_individuelle" }])).toEqual([]);
  });

  it("tous les lots ensemble : clés d'étapes, de champs et de photos uniques", () => {
    const t = composeBtpTemplate(VISIT_LOTS);
    const sections = t.sections.map((s) => s.key);
    expect(new Set(sections).size).toBe(sections.length);
    const fields = t.sections.flatMap((s) => s.fields.map((f) => f.key));
    expect(new Set(fields).size).toBe(fields.length);
    const slots = t.sections.flatMap((s) => s.photos.map((p) => p.key));
    expect(new Set(slots).size).toBe(slots.length);
    // Les PV et PAC air-eau ont tous deux une étape « electricite » : préfixées par lot.
    expect(sections).toContain("photovoltaique.electricite");
    expect(sections).toContain("pac_air_eau.electricite");
    expect(sections).toContain("electricite.releves");
  });

  it("chaque étape porte une des 4 phases terrain après Client/chantier", () => {
    const t = composeBtpTemplate(["plomberie", "toiture"]);
    for (const s of t.sections) expect(["etat_des_lieux", "releves", "photos_points", "synthese"]).toContain(s.phase);
    expect(t.sections.filter((s) => s.phase === "releves").every((s) => s.lot)).toBe(true);
  });

  it("Inconnu / Non vérifié / Non applicable acceptés et affichés tels quels, jamais comme conformes", () => {
    const t = composeBtpTemplate(["electricite"]);
    const hit = findTemplateField(t, "electricite.differentiel_30ma")!;
    expect(hit.section.key).toBe("electricite.releves");
    expect(validateFieldValue(hit.field, "__non_verifie")).toBeNull();
    expect(formatAnswer(hit.field, "__non_verifie")).toBe("Non vérifié");
    expect(formatAnswer(hit.field, "__inconnu")).toBe("Inconnu");
    expect(validateFieldValue(hit.field, "__conforme")).not.toBeNull();
  });

  it("un champ obligatoire marqué Non applicable compte comme traité", () => {
    const t = composeBtpTemplate(["electricite"]);
    const before = computeProgress(t, { answers: {}, ...empty });
    const after = computeProgress(t, { answers: { "electricite.alimentation": "__non_applicable" }, ...empty });
    const s = (p: typeof before) => p.sections.find((x) => x.key === "electricite.releves")!;
    expect(s(after).filledRequiredFields).toBe(s(before).filledRequiredFields + 1);
  });

  it("conclusion « sous conditions » : les conditions deviennent obligatoires", () => {
    const t = composeBtpTemplate(["plomberie"]);
    const p1 = computeProgress(t, { answers: { btp_conclusion: "faisable" }, ...empty });
    const p2 = computeProgress(t, { answers: { btp_conclusion: "sous_conditions" }, ...empty });
    const c = (p: typeof p1) => p.sections.find((x) => x.key === "btp_conclusion")!;
    expect(c(p1).missingFieldLabels).toEqual([]);
    expect(c(p2).missingFieldLabels).toContain("Conditions à lever");
  });

  it("zones répétées selon le nombre saisi, photo par zone rattachée à la bonne étape", () => {
    const t = composeBtpTemplate(["renovation"]);
    const zones = resolveSections(t, { btp_zones_count: 3 }).find((s) => s.section.key === "btp_zones")!;
    expect(zones.blocks).toHaveLength(3);
    expect(findTemplateSlot(t, "btp_zones", "zone_photo__2")).not.toBeNull();
    expect(findTemplateSlot(t, "btp_site", "zone_photo__2")).toBeNull();
    expect(validateAnswerEntries(t, [{ section_key: "btp_zones", field_key: "zone_longueur__0", value: -1 }])).toHaveLength(1);
  });

  it("champ d'un lot non retenu refusé", () => {
    const t = composeBtpTemplate(["plomberie"]);
    expect(validateAnswerEntries(t, [{ section_key: "electricite.releves", field_key: "electricite.alimentation", value: "monophase" }])).toHaveLength(1);
  });

  it("lots normalisés (ordre canonique, doublons et inconnus retirés)", () => {
    expect(normalizeLots(["toiture", "plomberie", "toiture", "inconnu"])).toEqual(["plomberie", "toiture"]);
  });

  it("création BTP sans lot refusée", () => {
    const base = {
      companyId: "00000000-0000-4000-8000-000000000001",
      client_id: "00000000-0000-4000-8000-000000000002",
      new_chantier: {},
      idempotency_key: "abcdefgh12",
    };
    expect(CreateVisitSchema.safeParse({ ...base, visit_type: "btp", lots: [] }).success).toBe(false);
    expect(CreateVisitSchema.safeParse({ ...base, visit_type: "btp", lots: ["plomberie"] }).success).toBe(true);
    expect(CreateVisitSchema.safeParse({ ...base, visit_type: "btp", lots: ["piscine"] }).success).toBe(false);
  });
});

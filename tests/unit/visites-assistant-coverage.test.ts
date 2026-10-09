import { describe, expect, test } from "bun:test";
import { resolveVisitTemplate } from "@/lib/visites/templates";
import { matchesConditions, resolveSections } from "@/lib/visites/engine";
import { buildAssistantContextWithMeta, sanitizeProposals } from "@/lib/visites/assistant";

const tpl = resolveVisitTemplate({
  visit_type: "btp",
  lots: ["electricite", "photovoltaique", "isolation_facade"],
})!;
const base = {
  visit: { reference: "VT-T", status: "en_cours", lots: ["electricite", "photovoltaique"] },
  photoSlotCounts: {},
  skippedSlots: new Set<string>(),
  constraints: [],
};

function bigVisit() {
  const answers: Record<string, never> = {
    btp_zones_count: 20 as never,
    btp_conclusion: "faisable" as never,
  };
  const zoneKeys = resolveSections(tpl, answers)
    .find((r) => r.section.key === "btp_zones")!
    .blocks.map((b) => b.fields.find((f) => f.key === "zone_surface")!.answerKey);
  expect(zoneKeys).toHaveLength(20);
  zoneKeys.forEach((k, i) => ((answers as Record<string, unknown>)[k] = 10 + i));
  const elecField = tpl.sections
    .find((s) => s.key === "electricite.releves")!
    .fields.find((f) => f.type === "text" || f.type === "number")!;
  (answers as Record<string, unknown>)[elecField.key] =
    elecField.type === "number" ? 12 : "Tableau ancien";
  return { answers: answers as Record<string, never>, elecKey: elecField.key };
}

describe("contexte IA — 20 zones + électricité + PV", () => {
  test("guide sur étape électricité : champs du lot et conclusion gardés, omission déclarée", () => {
    const { answers, elecKey } = bigVisit();
    const { text, coverage } = buildAssistantContextWithMeta(
      { ...base, template: tpl, answers },
      "guide",
      { sectionKey: "electricite.releves" },
    );
    expect(text).toContain(`- ${elecKey} |`);
    expect(text).toContain("- btp_conclusion |");
    expect(text).toContain("- photovoltaique.");
    expect(coverage.omitted).toBeGreaterThan(0);
    expect(coverage.omittedSections.length).toBeGreaterThan(0);
    expect(text).toContain("COUVERTURE PARTIELLE");
  });

  test("synthèse : toute la visite couverte, données métier et conclusion présentes", () => {
    const { answers, elecKey } = bigVisit();
    const { text, coverage } = buildAssistantContextWithMeta(
      { ...base, template: tpl, answers },
      "synthese",
      {},
    );
    expect(coverage.omitted).toBe(0);
    expect(coverage.included).toBe(coverage.total);
    expect(text).toContain(`- ${elecKey} |`);
    expect(text).toContain("- btp_conclusion |");
    expect(text).not.toContain("COUVERTURE PARTIELLE");
    expect((text.match(/zone_surface/g) ?? []).length).toBe(20);
  });
});

describe("conditions multi-choix", () => {
  test("ancien comportement scalaire inchangé", () => {
    expect(matchesConditions([{ field: "a", in: ["x", "y"] }], { a: "y" })).toBe(true);
    expect(matchesConditions([{ field: "a", in: ["x"] }], { a: "z" })).toBe(false);
  });
  test("plusieurs moyens d'accès : hauteur de travail visible", () => {
    const answers = { btp_moyens_acces: ["echafaudage", "nacelle"] };
    const keys = resolveSections(tpl, answers).flatMap((r) =>
      r.blocks.flatMap((b) => b.fields.map((f) => f.answerKey)),
    );
    expect(keys).toContain("btp_hauteur_travail");
    expect(
      resolveSections(tpl, { btp_moyens_acces: ["plain_pied"] }).flatMap((r) =>
        r.blocks.flatMap((b) => b.fields.map((f) => f.answerKey)),
      ),
    ).not.toContain("btp_hauteur_travail");
  });
  test("isolation ITE + combles : deux surfaces visibles, proposables et dans le contexte", () => {
    const answers = { "isolation_facade.ouvrages": ["ite", "combles_perdus"] };
    const keys = resolveSections(tpl, answers).flatMap((r) =>
      r.blocks.flatMap((b) => b.fields.map((f) => f.answerKey)),
    );
    expect(keys).toContain("isolation_facade.surface_murs");
    expect(keys).toContain("isolation_facade.surface_combles");
    expect(keys).not.toContain("isolation_facade.surface_plancher");
    const r = sanitizeProposals(tpl, answers, [
      { field_key: "isolation_facade.surface_combles", value_json: "45" },
    ]);
    expect(r).toHaveLength(1);
    const { text } = buildAssistantContextWithMeta(
      { ...base, template: tpl, answers },
      "dictee",
      {},
    );
    expect(text).toContain("- isolation_facade.surface_murs |");
  });
});

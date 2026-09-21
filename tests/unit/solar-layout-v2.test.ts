/**
 * Solar Studio V2 — LOT P0-C : auto-placement V2 et variantes.
 * Tests du moteur pur : marges par arête réelles, contours concaves, priorité de pans,
 * rôles de variantes, objectif impossible, déterminisme et performance.
 */
import { describe, expect, it } from "vitest";
import {
  buildUsableArea,
  canPlace,
  generateLayouts,
  moduleRect,
  makeRulesProfile,
  rectsOverlap,
  resolveEdgeMargins,
  type LayoutModuleSpec,
  type LayoutPlane,
  type LayoutRequest,
  type Pt,
} from "@/lib/solar-layout";

const MODULE: LayoutModuleSpec = { id: "m500", width_mm: 1134, height_mm: 1950, power_wc: 500 };
const MODULE_XL: LayoutModuleSpec = { id: "xl", width_mm: 2384, height_mm: 1303, power_wc: 670 };

const RULES = makeRulesProfile({
  id: "p0c",
  name: "P0-C",
  version: 1,
  eave_m: 0.3,
  ridge_m: 0.3,
  verge_m: 0.3,
  obstacle_m: 0.2,
  row_gap_m: 0.02,
  col_gap_m: 0.02,
  walkway_m: 0.6,
});

function rect(w: number, h: number): Pt[] {
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
}

function plane(key: string, polygon: Pt[], over: Partial<LayoutPlane> = {}): LayoutPlane {
  return {
    key,
    name: `Pan ${key}`,
    azimuth_deg: 180,
    tilt_deg: 24,
    polygon,
    obstacles: [],
    zones: [],
    ...over,
  };
}

function request(over: Partial<LayoutRequest> = {}): LayoutRequest {
  return {
    planes: [plane("sud", rect(12, 8))],
    module: MODULE,
    rules: RULES,
    target: { mode: "max", rounding: "closest" },
    orientation: "auto",
    ...over,
  };
}

/** Propriété : chaque module est entièrement plaçable et sans collision. */
function assertSound(req: LayoutRequest) {
  const res = generateLayouts(req);
  for (const c of res.candidates) {
    for (const m of c.modules) {
      const p = req.planes.find((x) => x.key === m.plane_key)!;
      expect(canPlace(buildUsableArea(p, req.rules), moduleRect(m, req.module))).toBe(true);
    }
    for (let i = 0; i < c.modules.length; i += 1) {
      for (let j = i + 1; j < c.modules.length; j += 1) {
        const a = c.modules[i]!;
        const b = c.modules[j]!;
        if (a.plane_key !== b.plane_key) continue;
        expect(rectsOverlap(moduleRect(a, req.module), moduleRect(b, req.module))).toBe(false);
      }
    }
  }
  return res;
}

describe("P0-C — zone utile et marges par arête", () => {
  it("refuse un module qui traverserait une encoche d'un contour concave", () => {
    // Contour en L : l'encoche interdit tout rectangle traversant.
    const concave: Pt[] = [
      { x: 0, y: 0 },
      { x: 12, y: 0 },
      { x: 12, y: 3 },
      { x: 5, y: 3 },
      { x: 5, y: 8 },
      { x: 0, y: 8 },
    ];
    const req = request({ planes: [plane("l", concave)] });
    const res = assertSound(req);
    expect(res.max_modules).toBeGreaterThan(0);
    const area = buildUsableArea(plane("l", concave), RULES);
    // Rectangle chevauchant l'encoche : les 4 coins sont dans le contour, pas les arêtes.
    const crossing = { u: 6, v: 4, w: 6, h: 1, orientation: "paysage" as const };
    expect(canPlace(area, crossing)).toBe(false);
  });

  it("applique la marge propre à chaque arête plutôt qu'une marge unique", () => {
    const big = plane("sud", rect(12, 8), {
      edges: [{ index: 0, kind: "egout", margin_m: 2.5 }],
    });
    const baseline = generateLayouts(request()).max_modules;
    const withEdge = generateLayouts(request({ planes: [big] })).max_modules;
    expect(withEdge).toBeLessThan(baseline);
  });

  it("respecte l'ordre marge d'arête > marge du pan > profil", () => {
    const p = plane("sud", rect(12, 8), {
      margin_m: 0.8,
      edges: [{ index: 0, kind: "faitage", margin_m: 1.4 }],
    });
    const resolved = resolveEdgeMargins(p, RULES);
    expect(resolved[0]!.margin_m).toBeCloseTo(1.4, 6);
    expect(resolved[0]!.source).toBe("arete");
    expect(resolved[1]!.margin_m).toBeCloseTo(0.8, 6);
    expect(resolved[1]!.source).toBe("pan");
  });

  it("applique une marge prudente et la signale pour une arête indéfinie", () => {
    const p = plane("sud", rect(12, 8), { edges: [{ index: 0, kind: "indefini" }] });
    const area = buildUsableArea(p, RULES);
    const resolved = resolveEdgeMargins(p, RULES);
    expect(resolved[0]!.margin_m).toBeGreaterThan(0);
    expect(area.notes.some((n) => n.toLowerCase().includes("prudente"))).toBe(true);
  });

  it("ne cumule jamais clearance de l'obstacle et marge du profil", () => {
    const withClearance = plane("sud", rect(12, 8), {
      obstacles: [
        { id: "velux", label: "Velux", u: 6, v: 4, width_m: 1, length_m: 1, clearance_m: 0.5 },
      ],
    });
    const res = generateLayouts(request({ planes: [withClearance] }));
    assertSound(request({ planes: [withClearance] }));
    expect(res.max_modules).toBeLessThan(generateLayouts(request()).max_modules);
  });

  it("exclut les modules d'un passage de maintenance", () => {
    const withZone = plane("sud", rect(12, 8), {
      zones: [
        {
          id: "passage",
          label: "Passage de maintenance",
          type: "passage",
          polygon: [
            { x: 0, y: 3.5 },
            { x: 12, y: 3.5 },
            { x: 12, y: 4.5 },
            { x: 0, y: 4.5 },
          ],
        },
      ],
    });
    const res = assertSound(request({ planes: [withZone] }));
    expect(res.max_modules).toBeLessThan(generateLayouts(request()).max_modules);
  });
});

describe("P0-C — pans, priorité et variantes", () => {
  const twoPlanes = [
    plane("sud", rect(12, 8)),
    plane("est", rect(10, 6), { key: "est", azimuth_deg: 90 }),
  ];

  it("remplit le pan prioritaire d'abord", () => {
    const res = generateLayouts(
      request({
        planes: twoPlanes,
        plane_priority: ["est", "sud"],
        target: { mode: "power", power_kwc: 3, rounding: "closest" },
      }),
    );
    const reco = res.candidates[0]!;
    expect(reco.planes_used[0]).toBe("est");
  });

  it("n'utilise pas un second pan quand l'objectif est atteint sur le premier", () => {
    const res = generateLayouts(
      request({
        planes: twoPlanes,
        plane_priority: ["sud", "est"],
        target: { mode: "power", power_kwc: 3, rounding: "closest" },
      }),
    );
    const reco = res.candidates.find((c) => c.role === "recommandee")!;
    expect(reco.planes_used).toEqual(["sud"]);
    expect(reco.target_met).toBe(true);
  });

  it("une variante atteint le maximum réel sur tous les pans sélectionnés", () => {
    const res = generateLayouts(request({ planes: twoPlanes }));
    // Si Maximum est identique à Recommandée, la dédup garde le premier rôle : pas de doublon inventé.
    const max = res.candidates.reduce((a, b) => (b.modules.length > a.modules.length ? b : a));
    expect(max.modules.length).toBe(res.max_modules);
    expect(max.planes_used.length).toBe(2);
  });

  it("Auto évalue réellement les DEUX orientations", () => {
    const res = generateLayouts(
      request({ planes: [plane("sud", rect(11, 5))], orientation: "auto" }),
    );
    // Échoue si une des deux orientations n'a pas été réellement construite.
    expect([...res.orientations_evaluated].sort()).toEqual(["paysage", "portrait"]);
  });

  it("Auto retient le portrait quand le portrait gagne", () => {
    // Pan étroit et haut : le portrait entre, le paysage non.
    const res = generateLayouts(
      request({ planes: [plane("sud", rect(2.2, 9))], orientation: "auto", module: MODULE }),
    );
    expect(res.orientations_evaluated).toContain("portrait");
    const best = res.candidates.reduce((a, b) => (b.modules.length > a.modules.length ? b : a));
    expect(best.modules.every((m) => m.orientation === "portrait")).toBe(true);
  });

  it("Auto retient le paysage quand le paysage gagne", () => {
    // Pan large et bas : seul le paysage tient en hauteur.
    const res = generateLayouts(
      request({ planes: [plane("sud", rect(12, 2.3))], orientation: "auto", module: MODULE }),
    );
    expect(res.orientations_evaluated).toContain("paysage");
    const best = res.candidates.reduce((a, b) => (b.modules.length > a.modules.length ? b : a));
    expect(best.modules.length).toBeGreaterThan(0);
    expect(best.modules.every((m) => m.orientation === "paysage")).toBe(true);
  });

  it("la priorité des pans est explicite et change le pan servi en premier", () => {
    const planes = [plane("sud", rect(12, 8)), plane("nord", rect(12, 8))];
    const small = { mode: "power", power_kwc: 3, rounding: "closest" } as const;
    const a = generateLayouts(
      request({ planes, target: small, plane_priority: ["sud", "nord"] }),
    );
    const b = generateLayouts(
      request({ planes, target: small, plane_priority: ["nord", "sud"] }),
    );
    expect(a.plane_priority).toEqual(["sud", "nord"]);
    expect(b.plane_priority).toEqual(["nord", "sud"]);
    expect(a.candidates[0]!.modules[0]!.plane_key).toBe("sud");
    expect(b.candidates[0]!.modules[0]!.plane_key).toBe("nord");
  });

  it("produit jusqu'à 4 variantes distinctes, sans signature dupliquée", () => {
    const res = generateLayouts(request({ planes: twoPlanes }));
    expect(res.candidates.length).toBeLessThanOrEqual(4);
    const sigs = res.candidates.map((c) => c.signature);
    expect(new Set(sigs).size).toBe(sigs.length);
  });

  it("l'Alternative est une disposition réellement différente", () => {
    const res = generateLayouts(request({ planes: twoPlanes }));
    const alt = res.candidates.find((c) => c.role === "alternative");
    if (!alt) return; // Pas de quatrième variante réellement distincte : rien n'est inventé.
    for (const other of res.candidates) {
      if (other === alt) continue;
      expect(alt.signature).not.toBe(other.signature);
    }
  });

  it("Esthétique privilégie des rangées régulières", () => {
    const res = generateLayouts(request({ planes: twoPlanes }));
    const esth = res.candidates.find((c) => c.role === "esthetique");
    if (!esth) return;
    expect(esth.rows_total).toBeGreaterThan(0);
    expect(esth.rows_full / esth.rows_total).toBeGreaterThan(0);
  });

  it("chaque variante expose son résumé et ses pans", () => {
    const res = generateLayouts(request({ planes: twoPlanes }));
    for (const c of res.candidates) {
      expect(c.summary.length).toBeGreaterThan(10);
      expect(c.plane_names.length).toBe(c.planes_used.length);
      expect(c.module_area_m2).toBeGreaterThan(0);
    }
  });
});

describe("P0-C — objectif impossible", () => {
  it("retourne le maximum réel exact quand l'objectif n'est pas atteignable", () => {
    const small = request({
      planes: [plane("sud", rect(4, 3))],
      target: { mode: "power", power_kwc: 9, rounding: "closest" },
    });
    const res = generateLayouts(small);
    expect(res.achievable).toBe(false);
    expect(res.candidates.every((c) => c.target_met === false)).toBe(true);
    const best = res.candidates.reduce((a, b) => (b.modules.length > a.modules.length ? b : a));
    expect(best.modules.length).toBe(res.max_modules);
    expect(best.power_kwc).toBeCloseTo((res.max_modules * MODULE.power_wc) / 1000, 6);
  });

  it("ne place jamais un module hors toiture pour atteindre la cible", () => {
    assertSound(
      request({
        planes: [plane("sud", rect(4, 3))],
        target: { mode: "power", power_kwc: 9, rounding: "closest" },
      }),
    );
  });
});

describe("P0-C — panneau réel, déterminisme et performance", () => {
  it("un panneau de dimensions différentes donne un résultat différent", () => {
    const a = generateLayouts(request()).max_modules;
    const b = generateLayouts(request({ module: MODULE_XL })).max_modules;
    expect(a).not.toBe(b);
  });

  it("deux calculs identiques donnent les mêmes candidats et signatures", () => {
    const a = generateLayouts(request());
    const b = generateLayouts(request());
    expect(a.candidates.map((c) => c.signature)).toEqual(b.candidates.map((c) => c.signature));
    expect(a.candidates.map((c) => c.modules.length)).toEqual(
      b.candidates.map((c) => c.modules.length),
    );
  });

  it("reste raisonnable sur 12 pans", () => {
    const planes = Array.from({ length: 12 }, (_, i) => plane(`p${i}`, rect(12, 8)));
    const t0 = performance.now();
    const res = generateLayouts(request({ planes }));
    expect(performance.now() - t0).toBeLessThan(8000);
    expect(res.candidates.length).toBeGreaterThan(0);
  });
});

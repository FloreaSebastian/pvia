/**
 * Smart PV Layout Engine — tests unitaires, de propriété, de déterminisme
 * et de performance. Moteur testé seul, sans React ni 3D.
 */
import { describe, expect, it } from "vitest";
import {
  buildUsableArea,
  canPlace,
  generateLayouts,
  insetPolygon,
  makeRulesProfile,
  moduleRect,
  moduleSize,
  modulesForPower,
  polygonArea,
  rectsOverlap,
  rectInsidePolygon,
  suggestFix,
  toCCW,
  validateLayout,
  type LayoutModule,
  type LayoutModuleSpec,
  type LayoutPlane,
  type LayoutRequest,
  type Pt,
} from "@/lib/solar-layout";

const MODULE_500: LayoutModuleSpec = { id: "m500", width_mm: 1134, height_mm: 1950, power_wc: 500 };
const MODULE_455: LayoutModuleSpec = { id: "m455", width_mm: 1096, height_mm: 1754, power_wc: 455 };
const MODULE_XL: LayoutModuleSpec = { id: "xl", width_mm: 2384, height_mm: 1303, power_wc: 670 };
const MODULE_XS: LayoutModuleSpec = { id: "xs", width_mm: 800, height_mm: 1200, power_wc: 200 };

const RULES = makeRulesProfile({
  id: "enervia-resi",
  name: "ENERVIA — Résidentiel",
  version: 3,
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

function plane(polygon: Pt[], over: Partial<LayoutPlane> = {}): LayoutPlane {
  return {
    key: "sud",
    name: "Pan Sud",
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
    planes: [plane(rect(12, 7))],
    module: MODULE_500,
    rules: RULES,
    target: { mode: "max", rounding: "closest" },
    orientation: "auto",
    ...over,
  };
}

/** Contrôle de propriété commun à tout layout généré. */
function assertLayoutIsSound(modules: LayoutModule[], planes: LayoutPlane[], spec: LayoutModuleSpec) {
  for (const m of modules) {
    expect(Number.isFinite(m.u)).toBe(true);
    expect(Number.isFinite(m.v)).toBe(true);
    const p = planes.find((x) => x.key === m.plane_key)!;
    const area = buildUsableArea(p, RULES);
    expect(canPlace(area, moduleRect(m, spec))).toBe(true);
  }
  for (let i = 0; i < modules.length; i += 1) {
    for (let j = i + 1; j < modules.length; j += 1) {
      const a = modules[i]!;
      const b = modules[j]!;
      if (a.plane_key !== b.plane_key) continue;
      expect(rectsOverlap(moduleRect(a, spec), moduleRect(b, spec))).toBe(false);
    }
  }
  expect(new Set(modules.map((m) => m.id)).size).toBe(modules.length);
}

describe("géométrie polygonale", () => {
  it("réduit correctement un rectangle", () => {
    const inset = insetPolygon(rect(10, 6), 1);
    expect(polygonArea(inset)).toBeCloseTo(8 * 4, 6);
  });

  it("réduit un trapèze sans le déformer vers le centroïde", () => {
    const trapeze: Pt[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 7, y: 5 },
      { x: 3, y: 5 },
    ];
    const inset = insetPolygon(trapeze, 0.5);
    expect(polygonArea(inset)).toBeLessThan(polygonArea(trapeze));
    // Les arêtes horizontales restent horizontales et se décalent de la marge exacte.
    const ys = inset.map((p) => p.y).sort((a, b) => a - b);
    expect(ys[0]).toBeCloseTo(0.5, 6);
    expect(ys[3]).toBeCloseTo(4.5, 6);
  });

  it("réduit un triangle", () => {
    const tri: Pt[] = [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 4, y: 6 },
    ];
    const inset = insetPolygon(tri, 0.4);
    expect(inset.length).toBe(3);
    expect(polygonArea(inset)).toBeLessThan(polygonArea(tri));
    expect(polygonArea(inset)).toBeGreaterThan(0);
  });

  it("détecte qu'un rectangle sort d'un polygone concave", () => {
    const concave: Pt[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 6 },
      { x: 5, y: 3 },
      { x: 0, y: 6 },
    ];
    expect(rectInsidePolygon({ u: 5, v: 4, width: 2, length: 2 }, toCCW(concave))).toBe(false);
    expect(rectInsidePolygon({ u: 2, v: 1, width: 2, length: 1.5 }, toCCW(concave))).toBe(true);
  });
});

describe("zone exploitable", () => {
  it("retranche les marges, les obstacles et les zones interdites", () => {
    const p = plane(rect(10, 6), {
      obstacles: [{ id: "chem", u: 5, v: 3, width_m: 1, length_m: 1 }],
      zones: [{ id: "z1", type: "interdite", polygon: rect(2, 2) }],
    });
    const area = buildUsableArea(p, RULES);
    expect(area.area_m2).toBeLessThan(polygonArea(rect(10, 6)));
    expect(area.blockedRects[0]!.width).toBeCloseTo(1.4, 6);
  });

  it("ne bloque pas sur une zone prioritaire", () => {
    const p = plane(rect(10, 6), { zones: [{ id: "z", type: "prioritaire", polygon: rect(4, 4) }] });
    const area = buildUsableArea(p, RULES);
    expect(area.blockedPolygons.length).toBe(0);
    expect(area.priorityPolygons.length).toBe(1);
  });
});

describe("objectif de puissance", () => {
  it("convertit une puissance en nombre de modules", () => {
    expect(modulesForPower(6, 500, "closest")).toBe(12);
    expect(modulesForPower(9, 500, "closest")).toBe(18);
    expect(modulesForPower(7.5, 500, "closest")).toBe(15);
    expect(modulesForPower(7.4, 500, "under")).toBe(14);
    expect(modulesForPower(7.1, 500, "over")).toBe(15);
  });

  it("atteint exactement une cible de 6 kWc", () => {
    const res = generateLayouts(request({ target: { mode: "power", power_kwc: 6, rounding: "closest" } }));
    expect(res.achievable).toBe(true);
    const exact = res.candidates.find((c) => c.criteria.module_count === 12);
    expect(exact).toBeDefined();
    expect(exact!.power_kwc).toBeCloseTo(6, 2);
    assertLayoutIsSound(exact!.modules, request().planes, MODULE_500);
  });

  it("signale une cible impossible et propose le maximum réel", () => {
    const small = request({
      planes: [plane(rect(4, 3))],
      target: { mode: "power", power_kwc: 9, rounding: "closest" },
    });
    const res = generateLayouts(small);
    expect(res.target_modules).toBe(18);
    expect(res.achievable).toBe(false);
    expect(res.max_modules).toBeLessThan(18);
    expect(res.max_power_kwc).toBeCloseTo((res.max_modules * 500) / 1000, 2);
  });
});

describe("génération sur géométries variées", () => {
  const cases: { name: string; polygon: Pt[] }[] = [
    { name: "rectangle", polygon: rect(12, 7) },
    { name: "grande toiture", polygon: rect(30, 14) },
    { name: "petite toiture", polygon: rect(5, 4) },
    {
      name: "triangle",
      polygon: [
        { x: 0, y: 0 },
        { x: 12, y: 0 },
        { x: 6, y: 7 },
      ],
    },
    {
      name: "trapèze",
      polygon: [
        { x: 0, y: 0 },
        { x: 12, y: 0 },
        { x: 9, y: 6 },
        { x: 3, y: 6 },
      ],
    },
    {
      name: "concave",
      polygon: [
        { x: 0, y: 0 },
        { x: 12, y: 0 },
        { x: 12, y: 7 },
        { x: 7, y: 4 },
        { x: 5, y: 7 },
        { x: 0, y: 7 },
      ],
    },
  ];

  for (const c of cases) {
    it(`respecte toutes les contraintes — ${c.name}`, () => {
      const req = request({ planes: [plane(c.polygon)] });
      const res = generateLayouts(req);
      expect(res.candidates.length).toBeGreaterThan(0);
      for (const cand of res.candidates) assertLayoutIsSound(cand.modules, req.planes, MODULE_500);
    });
  }

  it("contourne une cheminée centrale en produisant plusieurs matrices", () => {
    const p = plane(rect(12, 7), {
      obstacles: [{ id: "chem", u: 6, v: 3.5, width_m: 1.2, length_m: 1.2 }],
    });
    const res = generateLayouts(request({ planes: [p] }));
    const best = res.candidates[0]!;
    assertLayoutIsSound(best.modules, [p], MODULE_500);
    expect(best.modules.every((m) => Math.abs(m.u - 6) > 0.5 || Math.abs(m.v - 3.5) > 0.5)).toBe(true);
  });

  it("prend en compte deux obstacles", () => {
    const p = plane(rect(12, 7), {
      obstacles: [
        { id: "a", u: 3, v: 2, width_m: 0.8, length_m: 0.8 },
        { id: "b", u: 9, v: 5, width_m: 1, length_m: 1 },
      ],
    });
    const withOut = generateLayouts(request()).max_modules;
    const withObs = generateLayouts(request({ planes: [p] })).max_modules;
    expect(withObs).toBeLessThan(withOut);
  });

  it("respecte une zone interdite et un passage technique", () => {
    const p = plane(rect(12, 7), {
      zones: [
        { id: "int", type: "interdite", polygon: rect(3, 3) },
        {
          id: "pass",
          type: "passage",
          polygon: [
            { x: 5.5, y: 0 },
            { x: 6.1, y: 0 },
            { x: 6.1, y: 7 },
            { x: 5.5, y: 7 },
          ],
        },
      ],
    });
    const res = generateLayouts(request({ planes: [p] }));
    for (const cand of res.candidates) assertLayoutIsSound(cand.modules, [p], MODULE_500);
  });

  it("compare réellement portrait et paysage au lieu d'imposer portrait", () => {
    const wide = plane(rect(12, 2.6));
    const portraitOnly = generateLayouts(request({ planes: [wide], orientation: "portrait" })).max_modules;
    const auto = generateLayouts(request({ planes: [wide], orientation: "auto" }));
    expect(auto.max_modules).toBeGreaterThanOrEqual(portraitOnly);
    expect(auto.candidates[0]!.orientation === "paysage" || auto.max_modules === portraitOnly).toBe(true);
  });

  it("adapte le nombre de modules à leur taille", () => {
    const big = generateLayouts(request({ module: MODULE_XL })).max_modules;
    const small = generateLayouts(request({ module: MODULE_XS })).max_modules;
    expect(small).toBeGreaterThan(big);
  });

  it("recalcule tout lors d'un changement de module", () => {
    const a = generateLayouts(request({ module: MODULE_500 }));
    const b = generateLayouts(request({ module: MODULE_455 }));
    expect(a.max_power_kwc).not.toBe(b.max_power_kwc);
  });

  it("des marges plus grandes réduisent la pose", () => {
    const serré = generateLayouts(request({ rules: makeRulesProfile({ eave_m: 0.1, ridge_m: 0.1, verge_m: 0.1 }) }));
    const large = generateLayouts(request({ rules: makeRulesProfile({ eave_m: 1, ridge_m: 1, verge_m: 1 }) }));
    expect(large.max_modules).toBeLessThan(serré.max_modules);
  });
});

describe("multi-pans", () => {
  const planes: LayoutPlane[] = [
    plane(rect(8, 5), { key: "sud", name: "Sud" }),
    plane(rect(6, 4), { key: "ouest", name: "Ouest", azimuth_deg: 270 }),
  ];

  it("répartit un objectif global sur plusieurs pans", () => {
    const res = generateLayouts(
      request({ planes, plane_priority: ["sud", "ouest"], target: { mode: "count", count: 999, rounding: "closest" } }),
    );
    const best = res.candidates[0]!;
    const keys = new Set(best.modules.map((m) => m.plane_key));
    expect(keys.size).toBe(2);
    assertLayoutIsSound(best.modules, planes, MODULE_500);
  });

  it("remplit d'abord le pan prioritaire", () => {
    const res = generateLayouts(
      request({ planes, plane_priority: ["ouest", "sud"], target: { mode: "count", count: 4, rounding: "closest" } }),
    );
    const best = res.candidates.find((c) => c.criteria.module_count === 4)!;
    expect(best.modules.every((m) => m.plane_key === "ouest")).toBe(true);
  });
});

describe("variantes", () => {
  it("ne duplique jamais deux propositions identiques", () => {
    const res = generateLayouts(request({ planes: [plane(rect(4, 3.2))] }));
    const sigs = res.candidates.map((c) => c.signature);
    expect(new Set(sigs).size).toBe(sigs.length);
  });

  it("explique la recommandation sans score opaque", () => {
    const res = generateLayouts(request({ target: { mode: "power", power_kwc: 6, rounding: "closest" } }));
    const reasons = res.candidates[0]!.reasons.join(" ");
    expect(reasons).toMatch(/kWc/);
    expect(reasons).not.toMatch(/IA/);
  });
});

describe("validation live", () => {
  const p = plane(rect(12, 7), { obstacles: [{ id: "chem", u: 6, v: 3.5, width_m: 1.2, length_m: 1.2 }] });

  function mod(u: number, v: number, id = "m1"): LayoutModule {
    return { id, plane_key: "sud", u, v, orientation: "portrait", row: 0, col: 0, matrix: 0 };
  }

  it("marque un panneau en collision avec la cheminée", () => {
    const [r] = validateLayout([p], [mod(6, 3.5)], MODULE_500, RULES);
    expect(r!.status).toBe("invalid");
    expect(r!.cause).toBe("collision_obstacle");
    expect(r!.required_m).toBeCloseTo(0.2, 6);
  });

  it("marque un recul insuffisant avec distance mesurée et seuil", () => {
    const size = moduleSize(MODULE_500, "portrait");
    const [r] = validateLayout([p], [mod(6, size.length / 2 + 0.18)], MODULE_500, RULES);
    expect(r!.status).toBe("invalid");
    expect(r!.cause).toBe("recul_insuffisant");
    expect(r!.measured_m).toBeCloseTo(0.18, 2);
    expect(r!.required_m).toBeCloseTo(0.3, 6);
  });

  it("marque un panneau hors toiture", () => {
    const [r] = validateLayout([p], [mod(20, 3)], MODULE_500, RULES);
    expect(r!.cause).toBe("hors_toiture");
  });

  it("marque un chevauchement entre panneaux", () => {
    const res = validateLayout([p], [mod(4, 3, "a"), mod(4.2, 3, "b")], MODULE_500, RULES);
    expect(res.every((r) => r.cause === "collision_module")).toBe(true);
  });

  it("ne supprime jamais un panneau invalide et propose une position valide proche", () => {
    const invalid = mod(6, 3.5);
    const fix = suggestFix(p, [invalid], invalid, MODULE_500, RULES);
    expect(fix).not.toBeNull();
    const moved: LayoutModule = { ...invalid, u: fix!.u, v: fix!.v };
    const [r] = validateLayout([p], [moved], MODULE_500, RULES);
    expect(r!.status).toBe("valid");
  });
});

describe("déterminisme", () => {
  it("produit exactement le même résultat sur 25 exécutions", () => {
    const req = request({ target: { mode: "power", power_kwc: 6, rounding: "closest" } });
    const reference = JSON.stringify(generateLayouts(req).candidates);
    for (let i = 0; i < 25; i += 1) {
      expect(JSON.stringify(generateLayouts(req).candidates)).toBe(reference);
    }
  });
});

describe("performance", () => {
  it("traite 4 pans et 10 obstacles rapidement", () => {
    const obstacles = Array.from({ length: 10 }, (_, i) => ({
      id: `o${i}`,
      u: 1.5 + (i % 5) * 2.2,
      v: 1.2 + Math.floor(i / 5) * 2.4,
      width_m: 0.6,
      length_m: 0.6,
    }));
    const planes = ["sud", "nord", "est", "ouest"].map((key, i) =>
      plane(rect(12, 6), { key, name: key, azimuth_deg: i * 90, obstacles }),
    );
    const req = request({ planes, target: { mode: "power", power_kwc: 9, rounding: "closest" } });

    const runs = 5;
    const times: number[] = [];
    for (let i = 0; i < runs; i += 1) {
      const t0 = performance.now();
      const res = generateLayouts(req);
      times.push(performance.now() - t0);
      expect(res.candidates.length).toBeGreaterThan(0);
    }
    const max = Math.max(...times);
    expect(max).toBeLessThan(4000);
  });
});

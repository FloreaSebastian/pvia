/**
 * Solar Studio V2 — P0-D : édition manuelle des panneaux.
 * Tests PURS du moteur d'édition : aucune donnée client, aucun appel réseau.
 */
import { describe, expect, test } from "bun:test";
import {
  addModule,
  alignSelection,
  allValid,
  canRedo,
  canUndo,
  createHistory,
  createManualContext,
  deleteSelection,
  distributeSelection,
  duplicateSelection,
  manualPowerKwc,
  modulesInRect,
  moveSelection,
  pushHistory,
  redoHistory,
  rotateSelection,
  sameLayout,
  snapDelta,
  toggleSelection,
  undoHistory,
  validateManual,
  type ManualResult,
} from "@/lib/solar-layout/manual";
import { manualContextToken } from "@/lib/solar-layout/token";
import { EMPTY_RULES_PROFILE } from "@/lib/solar-layout/rules";
import {
  LAYOUT_ENGINE_VERSION,
  type LayoutModule,
  type LayoutPlane,
  type RulesProfile,
} from "@/lib/solar-layout/types";

const RULES: RulesProfile = {
  ...EMPTY_RULES_PROFILE,
  id: "profil",
  name: "Test",
  version: 3,
  eave_m: 0.4,
  ridge_m: 0.4,
  verge_m: 0.4,
  valley_m: 0.4,
  hip_m: 0.4,
  obstacle_m: 0.3,
  row_gap_m: 0.02,
  col_gap_m: 0.02,
  walkway_m: 0.6,
};

const SPEC = { id: "mod", width_mm: 1000, height_mm: 1700, power_wc: 400 };

function plane(overrides: Partial<LayoutPlane> = {}): LayoutPlane {
  return {
    key: "pan-a",
    name: "Pan sud",
    azimuth_deg: 180,
    tilt_deg: 30,
    polygon: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 8 },
      { x: 0, y: 8 },
    ],
    obstacles: [],
    zones: [],
    ...overrides,
  };
}

function mod(
  id: string,
  u: number,
  v: number,
  orientation: "portrait" | "paysage" = "portrait",
): LayoutModule {
  return { id, plane_key: "pan-a", u, v, orientation, row: 0, col: 0, matrix: 0 };
}

function ctxOf(p: LayoutPlane = plane()) {
  return createManualContext([p], SPEC, RULES);
}

/** Propriété P0-D : après toute action acceptée, le brouillon reste valide. */
function expectAccepted(ctx: ReturnType<typeof ctxOf>, r: ManualResult): LayoutModule[] {
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error(r.message);
  expect(allValid(ctx, r.modules)).toBe(true);
  return r.modules;
}

describe("P0-D — déplacement", () => {
  test("déplacement valide accepté", () => {
    const ctx = ctxOf();
    const modules = [mod("a", 2, 2)];
    const next = expectAccepted(ctx, moveSelection(ctx, modules, ["a"], 1, 1));
    expect(next[0]!.u).toBe(3);
    expect(next[0]!.v).toBe(3);
  });

  test("déplacement hors toiture refusé", () => {
    const ctx = ctxOf();
    const r = moveSelection(ctx, [mod("a", 2, 2)], ["a"], 20, 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe("hors_toiture");
  });

  test("déplacement dans la marge de rive refusé", () => {
    const ctx = ctxOf();
    // Bord gauche du pan à u=0 : la marge de 0,40 m interdit u < 0,90.
    const r = moveSelection(ctx, [mod("a", 2, 2)], ["a"], -1.2, 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe("recul_insuffisant");
  });

  test("déplacement sur un obstacle refusé", () => {
    const ctx = ctxOf(
      plane({
        obstacles: [
          { id: "velux", label: "Velux", u: 5, v: 4, width_m: 1, length_m: 1, clearance_m: 0.3 },
        ],
      }),
    );
    const r = moveSelection(ctx, [mod("a", 2, 4)], ["a"], 3, 0);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.cause).toBe("collision_obstacle");
      expect(r.message).toBe("Velux");
    }
  });

  test("collision avec un autre panneau refusée", () => {
    const ctx = ctxOf();
    const modules = [mod("a", 2, 2), mod("b", 3.5, 2)];
    const r = moveSelection(ctx, modules, ["a"], 1.4, 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe("collision_module");
  });

  test("déplacement de groupe valide", () => {
    const ctx = ctxOf();
    const modules = [mod("a", 2, 2), mod("b", 3.1, 2)];
    const next = expectAccepted(ctx, moveSelection(ctx, modules, ["a", "b"], 0.5, 0));
    expect(next.map((m) => m.u)).toEqual([2.5, 3.6]);
  });

  test("déplacement de groupe refusé en bloc si un seul panneau sort", () => {
    const ctx = ctxOf();
    const modules = [mod("a", 2, 2), mod("b", 9, 2)];
    const r = moveSelection(ctx, modules, ["a", "b"], 1, 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.module_ids).toContain("b");
    // L'état d'origine n'est jamais modifié.
    expect(modules[0]!.u).toBe(2);
  });
});

describe("P0-D — rotation, ajout, duplication, suppression", () => {
  test("rotation valide", () => {
    const ctx = ctxOf();
    const next = expectAccepted(ctx, rotateSelection(ctx, [mod("a", 3, 3)], ["a"]));
    expect(next[0]!.orientation).toBe("paysage");
    expect(next[0]!.u).toBe(3);
  });

  test("rotation refusée si elle sort de la zone utile", () => {
    const ctx = ctxOf();
    // Portrait accepté à v = 1,3 ; en paysage la largeur 1,7 m déborde en u.
    const r = rotateSelection(ctx, [mod("a", 1.0, 4)], ["a"]);
    expect(r.ok).toBe(false);
  });

  test("ajout manuel valide", () => {
    const ctx = ctxOf();
    const next = expectAccepted(
      ctx,
      addModule(ctx, [], { plane_key: "pan-a", u: 3, v: 3, orientation: "portrait" }),
    );
    expect(next).toHaveLength(1);
    expect(next[0]!.id).toBe("manuel-1");
  });

  test("ajout refusé hors zone utile", () => {
    const ctx = ctxOf();
    const r = addModule(ctx, [], { plane_key: "pan-a", u: 0.1, v: 0.1, orientation: "portrait" });
    expect(r.ok).toBe(false);
  });

  test("duplication trouve une place à droite", () => {
    const ctx = ctxOf();
    const modules = [mod("a", 3, 3)];
    const r = duplicateSelection(ctx, modules, ["a"]);
    const next = expectAccepted(ctx, r);
    expect(next).toHaveLength(2);
    if (r.ok) expect(next.find((m) => m.id === r.selection[0])!.u).toBeCloseTo(4.02, 3);
  });

  test("duplication impossible quand aucune place n'est libre", () => {
    // Pan juste assez large pour un seul module.
    const narrow = plane({
      polygon: [
        { x: 0, y: 0 },
        { x: 1.9, y: 0 },
        { x: 1.9, y: 2.5 },
        { x: 0, y: 2.5 },
      ],
    });
    const ctx = ctxOf(narrow);
    const r = duplicateSelection(ctx, [mod("a", 0.95, 1.25)], ["a"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.cause).toBe("aucune_place");
  });

  test("suppression, y compris multiple", () => {
    const modules = [mod("a", 2, 2), mod("b", 4, 2), mod("c", 6, 2)];
    const r = deleteSelection(modules, ["a", "c"]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.modules.map((m) => m.id)).toEqual(["b"]);
  });
});

describe("P0-D — aligner et répartir", () => {
  test("aligner à gauche, droite, haut, bas", () => {
    const ctx = ctxOf();
    const modules = [mod("a", 3, 2), mod("b", 5, 4.2), mod("c", 7, 6)];
    const gauche = expectAccepted(ctx, alignSelection(ctx, modules, ["a", "b", "c"], "gauche"));
    expect(new Set(gauche.map((m) => m.u))).toEqual(new Set([3]));

    const droite = expectAccepted(ctx, alignSelection(ctx, modules, ["a", "b", "c"], "droite"));
    expect(new Set(droite.map((m) => m.u))).toEqual(new Set([7]));

    const bas = expectAccepted(ctx, alignSelection(ctx, modules, ["a", "b", "c"], "bas"));
    expect(new Set(bas.map((m) => m.v))).toEqual(new Set([2]));

    const haut = expectAccepted(ctx, alignSelection(ctx, modules, ["a", "b", "c"], "haut"));
    expect(new Set(haut.map((m) => m.v))).toEqual(new Set([6]));
  });

  test("alignement refusé s'il crée une collision", () => {
    const ctx = ctxOf();
    const modules = [mod("a", 3, 3), mod("b", 4.1, 3)];
    const r = alignSelection(ctx, modules, ["a", "b"], "gauche");
    expect(r.ok).toBe(false);
  });

  test("répartition horizontale régulière", () => {
    const ctx = ctxOf();
    const modules = [mod("a", 2, 4), mod("b", 3.4, 4), mod("c", 8, 4)];
    const next = expectAccepted(ctx, distributeSelection(ctx, modules, ["a", "b", "c"], "u"));
    expect(next.find((m) => m.id === "b")!.u).toBe(5);
  });

  test("répartition impossible avec moins de 3 panneaux", () => {
    const ctx = ctxOf();
    const r = distributeSelection(ctx, [mod("a", 2, 4), mod("b", 5, 4)], ["a", "b"], "u");
    expect(r.ok).toBe(false);
  });
});

describe("P0-D — accrochage et sélection", () => {
  test("accrochage sur le bord d'un voisin, avec ligne-guide", () => {
    const ctx = ctxOf();
    const modules = [mod("a", 3, 2), mod("b", 3, 4)];
    // Déplacement presque aligné : 4 cm d'écart, sous la tolérance.
    const snapped = snapDelta(ctx, modules, ["b"], 0.04, 0);
    expect(snapped.du).toBeCloseTo(0, 6);
    expect(snapped.guides.length).toBeGreaterThan(0);
  });

  test("Alt désactive l'accrochage", () => {
    const ctx = ctxOf();
    const modules = [mod("a", 3, 2), mod("b", 3, 4)];
    const raw = snapDelta(ctx, modules, ["b"], 0.04, 0, { enabled: false });
    expect(raw.du).toBe(0.04);
    expect(raw.guides).toHaveLength(0);
  });

  test("rectangle de sélection", () => {
    const modules = [mod("a", 2, 2), mod("b", 4, 2), mod("c", 8, 6)];
    const ids = modulesInRect(modules, SPEC, { u: 3, v: 2, width: 3, length: 2 }, "pan-a");
    expect(ids).toEqual(["a", "b"]);
  });

  test("Maj+clic ajoute puis retire de la sélection", () => {
    expect(toggleSelection(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleSelection(["a", "b"], "a")).toEqual(["b"]);
  });
});

describe("P0-D — historique et état brouillon", () => {
  test("50 actions annulables puis rétablies", () => {
    const ctx = ctxOf();
    let hist = createHistory<LayoutModule[]>([mod("a", 2, 2)]);
    for (let i = 0; i < 50; i += 1) {
      const r = moveSelection(ctx, hist.present, ["a"], 0.01, 0);
      expect(r.ok).toBe(true);
      if (r.ok) hist = pushHistory(hist, r.modules);
    }
    expect(hist.present[0]!.u).toBeCloseTo(2.5, 6);
    for (let i = 0; i < 50; i += 1) hist = undoHistory(hist);
    expect(canUndo(hist)).toBe(false);
    expect(hist.present[0]!.u).toBe(2);
    for (let i = 0; i < 50; i += 1) hist = redoHistory(hist);
    expect(canRedo(hist)).toBe(false);
    expect(hist.present[0]!.u).toBeCloseTo(2.5, 6);
  });

  test("état modifié détecté, puis à jour après retour", () => {
    const base = [mod("a", 2, 2)];
    const moved = [mod("a", 2.5, 2)];
    expect(sameLayout(base, base)).toBe(true);
    expect(sameLayout(base, moved)).toBe(false);
    expect(sameLayout(base, [])).toBe(false);
  });

  test("puissance recalculée localement", () => {
    expect(manualPowerKwc([mod("a", 2, 2), mod("b", 4, 2)], SPEC)).toBe(0.8);
  });
});

describe("P0-D — déterminisme et invariant global", () => {
  test("deux exécutions identiques donnent exactement le même résultat", () => {
    const ctx = ctxOf();
    const modules = [mod("a", 3, 3), mod("b", 5, 3)];
    const a = duplicateSelection(ctx, modules, ["a", "b"]);
    const b = duplicateSelection(ctx, modules, ["a", "b"]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test("après chaque action acceptée, aucun module invalide ni collision", () => {
    const ctx = ctxOf();
    let modules: LayoutModule[] = [mod("a", 2, 2)];
    const steps: (() => ManualResult)[] = [
      () => addModule(ctx, modules, { plane_key: "pan-a", u: 4, v: 2, orientation: "portrait" }),
      () => moveSelection(ctx, modules, ["a"], 0.5, 0.5),
      () => rotateSelection(ctx, modules, ["a"]),
      () => duplicateSelection(ctx, modules, ["a"]),
      () =>
        alignSelection(
          ctx,
          modules,
          modules.map((m) => m.id),
          "bas",
        ),
    ];
    for (const s of steps) {
      const r = s();
      if (!r.ok) continue;
      modules = r.modules;
      const bad = validateManual(ctx, modules).filter((v) => v.status !== "valid");
      expect(bad).toHaveLength(0);
    }
  });
});

describe("P0-D — jeton d'édition manuelle (serveur)", () => {
  const ref = {
    geometry_version: 7,
    geometry_hash: "abc",
    module: {
      variant_id: "11111111-1111-1111-1111-111111111111",
      revision_id: "22222222-2222-2222-2222-222222222222",
      width_mm: 1000,
      height_mm: 1700,
      depth_mm: 30,
      power_wc: 400,
      manufacturer: "Fabricant",
      model: "M-400",
    },
    rules_profile_id: "profil",
    rules_profile_version: 3,
    rules: RULES,
    engine_version: LAYOUT_ENGINE_VERSION,
    plane_ids: ["p1", "p2"],
  };

  test("jeton stable pour un contexte identique, ordre des pans indifférent", () => {
    expect(manualContextToken(ref)).toBe(manualContextToken({ ...ref, plane_ids: ["p2", "p1"] }));
  });

  test("jeton différent si la révision du panneau change", () => {
    expect(
      manualContextToken({
        ...ref,
        module: { ...ref.module, revision_id: "33333333-3333-3333-3333-333333333333" },
      }),
    ).not.toBe(manualContextToken(ref));
  });

  test("jeton différent si les dimensions ou la puissance changent", () => {
    expect(manualContextToken({ ...ref, module: { ...ref.module, width_mm: 1001 } })).not.toBe(
      manualContextToken(ref),
    );
    expect(manualContextToken({ ...ref, module: { ...ref.module, power_wc: 405 } })).not.toBe(
      manualContextToken(ref),
    );
  });

  test("jeton différent si la version OU le contenu des règles change", () => {
    expect(manualContextToken({ ...ref, rules_profile_version: 4 })).not.toBe(
      manualContextToken(ref),
    );
    expect(manualContextToken({ ...ref, rules: { ...RULES, eave_m: 0.5 } })).not.toBe(
      manualContextToken(ref),
    );
  });

  test("jeton différent si la toiture ou le moteur changent", () => {
    expect(manualContextToken({ ...ref, geometry_version: 8 })).not.toBe(manualContextToken(ref));
    expect(manualContextToken({ ...ref, geometry_hash: "def" })).not.toBe(manualContextToken(ref));
    expect(manualContextToken({ ...ref, engine_version: "9.9.9" })).not.toBe(
      manualContextToken(ref),
    );
  });
});

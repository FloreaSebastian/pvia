/**
 * Solar Studio V2 — P0-D.2 : règles d'interaction du canevas manuel.
 * Tests PURS : aucun DOM réel, aucune donnée client, aucun appel réseau.
 */
import { describe, expect, test } from "bun:test";
import {
  computeAddGhost,
  isModuleEventTarget,
  shouldDeselectOnBackgroundUp,
  GHOST_ID,
} from "@/lib/solar-layout/manual-canvas";
import { createManualContext, toggleSelection } from "@/lib/solar-layout/manual";
import { EMPTY_RULES_PROFILE } from "@/lib/solar-layout/rules";
import type { LayoutModule, LayoutPlane, RulesProfile } from "@/lib/solar-layout/types";

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

function mod(id: string, u: number, v: number): LayoutModule {
  return { id, plane_key: "pan-a", u, v, orientation: "portrait", row: 0, col: 0, matrix: 0 };
}

const ctxOf = (p: LayoutPlane = plane()) => createManualContext([p], SPEC, RULES);

/** Faux nœud DOM minimal : `closest` renvoie un objet si le sélecteur matche. */
function node(hasModule: boolean) {
  return { closest: (sel: string) => (hasModule && sel === "[data-module-id]" ? {} : null) };
}

describe("P0-D.2 — règles d'événements pointeur", () => {
  test("un événement issu d'un panneau est identifié", () => {
    expect(isModuleEventTarget(node(true))).toBe(true);
  });

  test("un événement du fond n'est pas identifié comme panneau", () => {
    expect(isModuleEventTarget(node(false))).toBe(false);
    expect(isModuleEventTarget(null)).toBe(false);
    expect(isModuleEventTarget({} as never)).toBe(false);
  });

  test("pointerup sur un panneau ne désélectionne jamais", () => {
    expect(
      shouldDeselectOnBackgroundUp({ fromModule: true, hasMarquee: false, dragging: false }),
    ).toBe(false);
  });

  test("pointerup dans le fond sans rectangle désélectionne", () => {
    expect(
      shouldDeselectOnBackgroundUp({ fromModule: false, hasMarquee: false, dragging: false }),
    ).toBe(true);
  });

  test("pointerup avec rectangle ou glisser en cours ne désélectionne pas", () => {
    expect(
      shouldDeselectOnBackgroundUp({ fromModule: false, hasMarquee: true, dragging: false }),
    ).toBe(false);
    expect(
      shouldDeselectOnBackgroundUp({ fromModule: false, hasMarquee: false, dragging: true }),
    ).toBe(false);
  });

  test("Maj/Ctrl+clic puis pointerup conservent la sélection basculée", () => {
    const afterShift = toggleSelection(["a"], "b");
    expect(afterShift).toEqual(["a", "b"]);
    // Le pointerup vient du panneau : aucune désélection de fond.
    expect(
      shouldDeselectOnBackgroundUp({ fromModule: true, hasMarquee: false, dragging: false }),
    ).toBe(false);
    const afterCtrl = toggleSelection(afterShift, "a");
    expect(afterCtrl).toEqual(["b"]);
  });
});

describe("P0-D.2 — fantôme d'ajout accroché", () => {
  test("accrochage sur le bord d'un voisin", () => {
    const ctx = ctxOf();
    const modules = [mod("a", 3, 3)];
    // Point brut légèrement décalé : doit s'aligner sur le centre u du voisin.
    const g = computeAddGhost(ctx, modules, "pan-a", { u: 3.04, v: 5 }, "portrait");
    expect(g.snapped).toBe(true);
    expect(g.at.u).toBeCloseTo(3, 6);
    expect(g.guides.length).toBeGreaterThan(0);
  });

  test("accrochage à l'espacement de rangée", () => {
    const ctx = ctxOf();
    const modules = [mod("a", 3, 3)];
    // Rangée du dessus : 1,7 m + 0,02 m d'espacement = 1,72 m.
    const g = computeAddGhost(ctx, modules, "pan-a", { u: 3, v: 4.69 }, "portrait");
    expect(g.at.v).toBeCloseTo(4.72, 6);
    expect(g.valid).toBe(true);
  });

  test("Alt désactive l'accrochage mais garde la validation", () => {
    const ctx = ctxOf();
    const modules = [mod("a", 3, 3)];
    const g = computeAddGhost(ctx, modules, "pan-a", { u: 3.04, v: 5 }, "portrait", {
      snap: false,
    });
    expect(g.snapped).toBe(false);
    expect(g.at.u).toBeCloseTo(3.04, 6);
    expect(g.guides).toEqual([]);
    expect(typeof g.valid).toBe("boolean");
  });

  test("position accrochée invalide => refus avec cause", () => {
    const ctx = ctxOf(
      plane({
        obstacles: [
          { id: "velux", label: "Velux", u: 5, v: 4, width_m: 1, length_m: 1, clearance_m: 0.3 },
        ],
      }),
    );
    const g = computeAddGhost(ctx, [], "pan-a", { u: 5, v: 4 }, "portrait");
    expect(g.valid).toBe(false);
    expect(g.cause.length).toBeGreaterThan(0);
  });

  test("hors toiture => fantôme rouge", () => {
    const ctx = ctxOf();
    const g = computeAddGhost(ctx, [], "pan-a", { u: 25, v: 4 }, "portrait");
    expect(g.valid).toBe(false);
  });

  test("le point posé est exactement la position accrochée affichée", () => {
    const ctx = ctxOf();
    const modules = [mod("a", 3, 3)];
    const g = computeAddGhost(ctx, modules, "pan-a", { u: 3.04, v: 5 }, "portrait");
    const committed = g.at;
    const again = computeAddGhost(ctx, modules, "pan-a", { u: 3.04, v: 5 }, "portrait");
    expect(again.at).toEqual(committed);
  });

  test("le fantôme n'est jamais persisté dans le brouillon", () => {
    const ctx = ctxOf();
    const modules = [mod("a", 3, 3)];
    computeAddGhost(ctx, modules, "pan-a", { u: 6, v: 3 }, "portrait");
    expect(modules.some((m) => m.id === GHOST_ID)).toBe(false);
    expect(modules).toHaveLength(1);
  });
});

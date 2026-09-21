/**
 * Solar Studio V2 — P0-D.1 : garde de sortie, contrat serveur manuel,
 * homogénéité multi-champs et performance du moteur manuel.
 * Tests PURS : aucune donnée client, aucun appel réseau, aucune écriture.
 */
import { describe, expect, test } from "bun:test";
import {
  decideLeaveStudio,
  decideStepChange,
  resolveManualLeave,
  resolveManualSaveState,
  shouldWarnBeforeUnload,
} from "@/lib/solar-layout/exit-guard";
import {
  MANUAL_BAD_POSITION_MESSAGE,
  MANUAL_DRIFT_MESSAGE,
  MANUAL_EMPTY_MESSAGE,
  MANUAL_STALE_GEOMETRY_MESSAGE,
  MANUAL_TOO_MANY_MESSAGE,
  MANUAL_UNKNOWN_PLANE_MESSAGE,
  MULTI_CONFIG_MESSAGE,
  assertManualArraysCompatible,
  manualArraysCompatible,
  manualGuardFailure,
  manualInvalidMessage,
  type ManualArrayRef,
  type ManualGuardContext,
} from "@/lib/solar-layout/manual-server";
import {
  createManualContext,
  moveSelection,
  modulesInRect,
  validateManual,
} from "@/lib/solar-layout/manual";
import { EMPTY_RULES_PROFILE } from "@/lib/solar-layout/rules";
import type { LayoutModule, LayoutPlane, RulesProfile } from "@/lib/solar-layout/types";

/* ------------------------------ 1. Garde de sortie ------------------------------ */

const base = { step: "implantation", roofDirty: false, manualEditing: false, manualDirty: false };

describe("garde de sortie du brouillon manuel", () => {
  test("sans brouillon, le changement d'étape passe directement", () => {
    expect(decideStepChange(base, "modules").action).toBe("proceed");
  });

  test("brouillon manuel : le changement d'étape est bloqué par un dialogue", () => {
    const s = { ...base, manualEditing: true, manualDirty: true };
    expect(decideStepChange(s, "modules").action).toBe("confirm-manual");
  });

  test("mode manuel ouvert mais propre : le changement d'étape passe", () => {
    const s = { ...base, manualEditing: true, manualDirty: false };
    expect(decideStepChange(s, "modules").action).toBe("proceed");
  });

  test("la toiture est prioritaire : un seul dialogue pertinent à la fois", () => {
    const s = { step: "toiture", roofDirty: true, manualEditing: true, manualDirty: true };
    expect(decideStepChange(s, "modules").action).toBe("confirm-roof");
  });

  test("revenir sur l'étape active ne déclenche aucun dialogue", () => {
    const s = { ...base, manualEditing: true, manualDirty: true };
    expect(decideStepChange(s, "implantation").action).toBe("proceed");
  });

  test("quitter l'atelier avec un brouillon manuel demande confirmation", () => {
    expect(decideLeaveStudio({ ...base, manualEditing: true, manualDirty: true }).action).toBe(
      "confirm-manual",
    );
    expect(decideLeaveStudio(base).action).toBe("proceed");
  });

  test("avertissement de fermeture d'onglet armé uniquement si brouillon", () => {
    expect(shouldWarnBeforeUnload(base)).toBe(false);
    expect(shouldWarnBeforeUnload({ ...base, manualEditing: true, manualDirty: true })).toBe(true);
    expect(shouldWarnBeforeUnload({ ...base, roofDirty: true })).toBe(true);
  });

  test("enregistrement réussi : on continue ; échec : on reste en édition", () => {
    expect(resolveManualLeave("save", true)).toEqual({
      proceed: true,
      stayInManual: false,
      restoreBaseline: false,
    });
    expect(resolveManualLeave("save", false)).toEqual({
      proceed: false,
      stayInManual: true,
      restoreBaseline: false,
    });
  });

  test("abandon : on restaure la référence puis on quitte ; rester : rien ne bouge", () => {
    expect(resolveManualLeave("discard")).toEqual({
      proceed: true,
      stayInManual: false,
      restoreBaseline: true,
    });
    expect(resolveManualLeave("stay")).toEqual({
      proceed: false,
      stayInManual: true,
      restoreBaseline: false,
    });
  });
});

/* --------------------------- 2. État « Modifié » exact -------------------------- */

describe("état de sauvegarde exact", () => {
  test("undo revenu à la référence retire l'état « modifié »", () => {
    expect(resolveManualSaveState("idle", true)).toBe("dirty");
    expect(resolveManualSaveState("idle", false)).toBe("idle");
    expect(resolveManualSaveState("saved", false)).toBe("saved");
  });

  test("redo réaffiche « modifié » même après un enregistrement réussi", () => {
    expect(resolveManualSaveState("saved", true)).toBe("dirty");
  });

  test("enregistrement en cours et erreur ne sont jamais masqués", () => {
    expect(resolveManualSaveState("saving", true)).toBe("saving");
    expect(resolveManualSaveState("error", false)).toBe("error");
  });
});

/* ------------------------ 3. Homogénéité des champs ---------------------------- */

const ARRAY: ManualArrayRef = {
  module_variant_id: "v1",
  module_revision_id: "r1",
  module_snapshot: {
    variant_id: "v1",
    revision_id: "r1",
    power_wc: 400,
    width_mm: 1000,
    height_mm: 1700,
  },
  rules_profile_id: "p1",
  rules_profile_version: 3,
  layout_engine_version: "2.0.0",
  params: { rules: { eave_m: 0.4 } },
};

function variantOf(patch: Partial<ManualArrayRef>): ManualArrayRef {
  return { ...ARRAY, ...patch };
}

describe("refus d'un contexte multi-champs ambigu", () => {
  test("champs homogènes acceptés", () => {
    expect(manualArraysCompatible([ARRAY, { ...ARRAY }])).toBe(true);
    expect(() => assertManualArraysCompatible([ARRAY, { ...ARRAY }])).not.toThrow();
  });

  test("un seul champ est toujours accepté", () => {
    expect(manualArraysCompatible([ARRAY])).toBe(true);
  });

  const divergences: [string, Partial<ManualArrayRef>][] = [
    ["variante de panneau différente", { module_variant_id: "v2" }],
    ["révision de panneau différente", { module_revision_id: "r2" }],
    [
      "dimensions du snapshot différentes",
      { module_snapshot: { ...(ARRAY.module_snapshot as object), width_mm: 1100 } },
    ],
    [
      "puissance du snapshot différente",
      { module_snapshot: { ...(ARRAY.module_snapshot as object), power_wc: 425 } },
    ],
    ["profil de règles différent", { rules_profile_id: "p2" }],
    ["version de règles différente", { rules_profile_version: 4 }],
    ["contenu de règles différent", { params: { rules: { eave_m: 0.5 } } }],
    ["version de moteur différente", { layout_engine_version: "2.1.0" }],
  ];

  for (const [label, patch] of divergences) {
    test(`refus : ${label}`, () => {
      const arrays = [ARRAY, variantOf(patch)];
      expect(manualArraysCompatible(arrays)).toBe(false);
      expect(() => assertManualArraysCompatible(arrays)).toThrow(MULTI_CONFIG_MESSAGE);
    });
  }
});

/* --------------------------- 4. Contrat serveur manuel ------------------------- */

const CTX: ManualGuardContext = {
  geometryVersion: 7,
  token: "pvia-manual-1:abc",
  planeKeys: ["pan-a", "pan-b"],
};

function payload(patch: Partial<Parameters<typeof manualGuardFailure>[1]> = {}) {
  return {
    geometryVersion: 7,
    manualToken: "pvia-manual-1:abc",
    modules: [{ plane_key: "pan-a", u: 1, v: 1 }],
    ...patch,
  };
}

describe("contrat serveur de l'enregistrement manuel", () => {
  test("charge utile conforme : aucun refus", () => {
    expect(manualGuardFailure(CTX, payload())).toBeNull();
  });

  test("version de toiture absente = refus (aucun contournement par null)", () => {
    expect(manualGuardFailure(CTX, payload({ geometryVersion: null }))).toBe(
      MANUAL_STALE_GEOMETRY_MESSAGE,
    );
    expect(manualGuardFailure(CTX, payload({ geometryVersion: undefined }))).toBe(
      MANUAL_STALE_GEOMETRY_MESSAGE,
    );
  });

  test("version de toiture périmée = refus", () => {
    expect(manualGuardFailure(CTX, payload({ geometryVersion: 6 }))).toBe(
      MANUAL_STALE_GEOMETRY_MESSAGE,
    );
  });

  test("jeton inventé ou absent = refus", () => {
    expect(manualGuardFailure(CTX, payload({ manualToken: "faux" }))).toBe(MANUAL_DRIFT_MESSAGE);
    expect(manualGuardFailure(CTX, payload({ manualToken: null }))).toBe(MANUAL_DRIFT_MESSAGE);
  });

  test("pan inconnu = refus", () => {
    expect(
      manualGuardFailure(CTX, payload({ modules: [{ plane_key: "pan-z", u: 1, v: 1 }] })),
    ).toBe(MANUAL_UNKNOWN_PLANE_MESSAGE);
  });

  test("implantation vide refusée sans confirmation, acceptée avec", () => {
    expect(manualGuardFailure(CTX, payload({ modules: [] }))).toBe(MANUAL_EMPTY_MESSAGE);
    expect(manualGuardFailure(CTX, payload({ modules: [], allowEmpty: true }))).toBeNull();
  });

  test("plus de 2000 panneaux = refus", () => {
    const modules = Array.from({ length: 2001 }, () => ({ plane_key: "pan-a", u: 1, v: 1 }));
    expect(manualGuardFailure(CTX, payload({ modules }))).toBe(MANUAL_TOO_MANY_MESSAGE);
  });

  test("plus de 12 pans utilisés = refus", () => {
    const planeKeys = Array.from({ length: 13 }, (_, i) => `pan-${i}`);
    const modules = planeKeys.map((plane_key) => ({ plane_key, u: 1, v: 1 }));
    expect(manualGuardFailure({ ...CTX, planeKeys }, payload({ modules }))).toBe(
      MANUAL_TOO_MANY_MESSAGE,
    );
  });

  test("coordonnées NaN, infinies ou hors bornes = refus", () => {
    for (const u of [Number.NaN, Number.POSITIVE_INFINITY, 2001, -2001]) {
      expect(manualGuardFailure(CTX, payload({ modules: [{ plane_key: "pan-a", u, v: 1 }] }))).toBe(
        MANUAL_BAD_POSITION_MESSAGE,
      );
    }
  });

  test("un seul panneau invalide suffit à refuser tout l'enregistrement", () => {
    expect(manualInvalidMessage([])).toBeNull();
    const msg = manualInvalidMessage([{ message: "Marge de rive" }, { message: "Collision" }]);
    expect(msg).toContain("2 panneaux en position interdite");
    expect(msg).toContain("Marge de rive");
  });
});

/* ------------------------------ 5. Performance --------------------------------- */

const RULES: RulesProfile = {
  ...EMPTY_RULES_PROFILE,
  id: "profil",
  name: "Perf",
  version: 1,
  eave_m: 0.3,
  ridge_m: 0.3,
  verge_m: 0.3,
  valley_m: 0.3,
  hip_m: 0.3,
  obstacle_m: 0.3,
  row_gap_m: 0.02,
  col_gap_m: 0.02,
  walkway_m: 0.6,
};
const SPEC = { id: "mod", width_mm: 1000, height_mm: 1700, power_wc: 400 };

function bigPlane(size: number): LayoutPlane {
  return {
    key: "pan-a",
    name: "Grand pan",
    azimuth_deg: 180,
    tilt_deg: 20,
    polygon: [
      { x: 0, y: 0 },
      { x: size, y: 0 },
      { x: size, y: size },
      { x: 0, y: size },
    ],
    obstacles: [],
    zones: [],
  };
}

function grid(count: number): LayoutModule[] {
  const perRow = Math.ceil(Math.sqrt(count));
  return Array.from({ length: count }, (_, i) => ({
    id: `m${i}`,
    plane_key: "pan-a",
    u: 0.6 + (i % perRow) * 1.1,
    v: 0.6 + Math.floor(i / perRow) * 1.8,
    orientation: "portrait" as const,
    row: Math.floor(i / perRow),
    col: i % perRow,
    matrix: 0,
  }));
}

describe("performance du moteur manuel", () => {
  test("200 panneaux : déplacement de groupe validé rapidement", () => {
    const modules = grid(200);
    const ctx = createManualContext([bigPlane(60)], SPEC, RULES);
    const ids = modules.slice(0, 20).map((m) => m.id);
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) moveSelection(ctx, modules, ids, 0.01, 0.01);
    const perDrag = (performance.now() - t0) / 20;
    expect(perDrag).toBeLessThan(120);
  });

  test("1000 panneaux : sélection et validation locale restent sous le seuil", () => {
    const modules = grid(1000);
    const ctx = createManualContext([bigPlane(140)], SPEC, RULES);
    const t0 = performance.now();
    const hit = modulesInRect(modules, SPEC, { u: 10, v: 10, width: 20, length: 20 }, "pan-a");
    const selection = validateManual(ctx, modules, hit.slice(0, 50));
    const elapsed = performance.now() - t0;
    expect(hit.length).toBeGreaterThan(0);
    expect(selection.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(1500);
  });
});

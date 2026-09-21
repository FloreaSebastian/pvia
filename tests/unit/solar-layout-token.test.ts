/**
 * Solar Studio V2 — LOT P0-C.1.
 *
 * 1. Le jeton de calcul fige TOUTES les entrées entre le calcul et l'écriture.
 * 2. Variante + champs + panneaux forment une seule charge utile transactionnelle.
 */
import { describe, expect, it } from "vitest";
import {
  applyLayoutRpcArgs,
  assertApplyRpcArgs,
  buildArrayPayloads,
  buildVariantPayload,
  candidateToken,
  computeContextToken,
  generateLayouts,
  makeRulesProfile,
  tokenMatches,
  COMPUTE_TOKEN_FORMAT,
  type ComputeContext,
  type LayoutModuleSpec,
  type LayoutPlane,
} from "@/lib/solar-layout";

const RULES = makeRulesProfile({
  id: "p0c1",
  name: "P0-C.1",
  version: 3,
  eave_m: 0.3,
  ridge_m: 0.3,
  verge_m: 0.3,
  obstacle_m: 0.2,
  row_gap_m: 0.02,
  col_gap_m: 0.02,
});

const MODULE: LayoutModuleSpec = { id: "m500", width_mm: 1134, height_mm: 1950, power_wc: 500 };

const PLANE: LayoutPlane = {
  key: "sud",
  name: "Pan sud",
  azimuth_deg: 180,
  tilt_deg: 24,
  polygon: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 7 },
    { x: 0, y: 7 },
  ],
  obstacles: [],
  zones: [],
};

function ctx(over: Partial<ComputeContext> = {}): ComputeContext {
  return {
    geometry_version: 7,
    geometry_hash: "hash-7",
    module: {
      variant_id: "var-1",
      revision_id: "rev-1",
      width_mm: 1134,
      height_mm: 1950,
      depth_mm: 30,
      power_wc: 500,
      manufacturer: "Fab",
      model: "M500",
    },
    rules_profile_id: "p0c1",
    rules_profile_version: 3,
    rules: RULES,
    engine_version: "2.0.0",
    plane_priority: ["sud", "nord"],
    target: { mode: "max", rounding: "closest" },
    orientation: "auto",
    ...over,
  };
}

const SIGNATURE = "0.00,0.00,p|1.20,0.00,p";

describe("P0-C.1 — jeton de calcul", () => {
  it("accepte le jeton exact issu du même contexte", () => {
    const token = candidateToken(computeContextToken(ctx()), SIGNATURE);
    expect(token.startsWith(COMPUTE_TOKEN_FORMAT)).toBe(true);
    expect(tokenMatches(token, ctx(), SIGNATURE)).toBe(true);
  });

  it("refuse un changement de révision du panneau", () => {
    const token = candidateToken(computeContextToken(ctx()), SIGNATURE);
    const drifted = ctx({ module: { ...ctx().module, revision_id: "rev-2" } });
    expect(tokenMatches(token, drifted, SIGNATURE)).toBe(false);
  });

  it("refuse un changement de dimensions ou de puissance du panneau", () => {
    const token = candidateToken(computeContextToken(ctx()), SIGNATURE);
    expect(
      tokenMatches(token, ctx({ module: { ...ctx().module, width_mm: 1140 } }), SIGNATURE),
    ).toBe(false);
    expect(
      tokenMatches(token, ctx({ module: { ...ctx().module, power_wc: 505 } }), SIGNATURE),
    ).toBe(false);
  });

  it("refuse un changement de version du profil de règles", () => {
    const token = candidateToken(computeContextToken(ctx()), SIGNATURE);
    expect(tokenMatches(token, ctx({ rules_profile_version: 4 }), SIGNATURE)).toBe(false);
  });

  it("refuse un contenu de règles modifié à version identique", () => {
    const token = candidateToken(computeContextToken(ctx()), SIGNATURE);
    const sameVersionOtherContent = ctx({
      rules: makeRulesProfile({ ...RULES, eave_m: 0.5 }),
    });
    expect(sameVersionOtherContent.rules_profile_version).toBe(3);
    expect(tokenMatches(token, sameVersionOtherContent, SIGNATURE)).toBe(false);
  });

  it("refuse un changement de version du moteur", () => {
    const token = candidateToken(computeContextToken(ctx()), SIGNATURE);
    expect(tokenMatches(token, ctx({ engine_version: "2.1.0" }), SIGNATURE)).toBe(false);
  });

  it("refuse un changement de toiture ou d'ordre de priorité des pans", () => {
    const token = candidateToken(computeContextToken(ctx()), SIGNATURE);
    expect(tokenMatches(token, ctx({ geometry_version: 8 }), SIGNATURE)).toBe(false);
    expect(tokenMatches(token, ctx({ plane_priority: ["nord", "sud"] }), SIGNATURE)).toBe(false);
  });

  it("refuse une signature de variante inventée et un jeton inventé", () => {
    const token = candidateToken(computeContextToken(ctx()), SIGNATURE);
    expect(tokenMatches(token, ctx(), "signature-inventee")).toBe(false);
    expect(tokenMatches("pvia-layout-1.deadbeef.cafe", ctx(), SIGNATURE)).toBe(false);
    expect(tokenMatches("", ctx(), SIGNATURE)).toBe(false);
  });
});

describe("P0-C.1 — variante et implantation : une seule transaction", () => {
  const res = generateLayouts({
    planes: [PLANE],
    plane_priority: ["sud"],
    module: MODULE,
    rules: RULES,
    target: { mode: "max", rounding: "closest" },
    orientation: "auto",
  });
  const candidate = res.candidates[0]!;
  const snapshot = { variant_id: "var-1", revision_id: "rev-1" };
  const arrays = buildArrayPayloads({
    planes: [PLANE],
    modules: candidate.modules,
    spec: MODULE,
    rules: RULES,
    idByKey: new Map([["sud", "plane-uuid"]]),
    snapshot,
    rulesProfileId: "p0c1",
  });

  it("envoie la variante DANS les arguments de l'appel atomique", () => {
    const variant = buildVariantPayload({
      label: "Recommandée",
      candidate,
      moduleVariantId: "var-1",
      snapshot,
      rules: RULES,
      rulesProfileId: "p0c1",
      target: { mode: "max", rounding: "closest" },
      orientation: "auto",
    });
    const args = applyLayoutRpcArgs({
      companyId: "co",
      modelId: "mo",
      geometryVersion: 7,
      arrays,
      variant,
    });
    // Un seul appel transporte variante + champs + panneaux : aucune variante
    // ne peut donc survivre à l'échec de l'écriture de l'implantation.
    expect(Object.keys(args).sort()).toEqual([
      "_arrays",
      "_company_id",
      "_expected_geometry_version",
      "_model_id",
      "_variant",
    ]);
    expect(args._variant?.module_count).toBe(candidate.modules.length);
    expect(args._variant?.modules.length).toBe(candidate.modules.length);
    expect(args._arrays[0]!.modules.length).toBe(candidate.modules.length);
  });

  it("n'envoie aucune variante quand l'utilisateur ne l'enregistre pas", () => {
    const args = applyLayoutRpcArgs({
      companyId: "co",
      modelId: "mo",
      geometryVersion: 7,
      arrays,
      variant: null,
    });
    expect(args._variant).toBeNull();
    expect(args._arrays.length).toBe(1);
  });
});

/**
 * P0-C.2 — contrat de l'unique transaction `solar_apply_layout`.
 * Ces règles sont dupliquées côté SQL : la base reste la barrière de sécurité
 * (appel direct possible), ce contrôle ferme le chemin applicatif.
 */
describe("P0-C.2 — contrat d'application", () => {
  const snapshot = { variant_id: "var-1", revision_id: "rev-1" };
  const arrays = buildArrayPayloads({
    planes: [PLANE],
    modules: [
      { id: "m1", plane_key: "sud", u: 0, v: 0, orientation: "portrait", row: 0, col: 0 },
    ],
    spec: MODULE,
    rules: RULES,
    idByKey: new Map([["sud", "plane-uuid"]]),
    snapshot,
    rulesProfileId: null,
  });
  const base = () =>
    applyLayoutRpcArgs({
      companyId: "co",
      modelId: "mo",
      geometryVersion: 7,
      arrays: JSON.parse(JSON.stringify(arrays)),
      variant: null,
    });

  it("accepte une charge utile conforme", () => {
    expect(() => assertApplyRpcArgs(base())).not.toThrow();
  });

  it("refuse une version de toiture absente", () => {
    const args = { ...base(), _expected_geometry_version: null as unknown as number };
    expect(() => assertApplyRpcArgs(args)).toThrow("expected_geometry_version_required");
  });

  it("refuse des champs qui ne sont pas une liste", () => {
    const args = { ...base(), _arrays: {} as never };
    expect(() => assertApplyRpcArgs(args)).toThrow("invalid_arrays_payload");
  });

  it("refuse plus de 12 champs", () => {
    const args = base();
    args._arrays = Array.from({ length: 13 }, () => args._arrays[0]!);
    expect(() => assertApplyRpcArgs(args)).toThrow("too_many_arrays");
  });

  it("refuse une orientation invalide", () => {
    const args = base();
    args._arrays[0]!.modules[0]!.orientation = "diagonale";
    expect(() => assertApplyRpcArgs(args)).toThrow("invalid_orientation");
  });

  it("refuse une position non finie ou hors bornes", () => {
    const a = base();
    a._arrays[0]!.modules[0]!.local_u_m = Number.NaN;
    expect(() => assertApplyRpcArgs(a)).toThrow("invalid_module_position");
    const b = base();
    b._arrays[0]!.modules[0]!.local_v_m = 5000;
    expect(() => assertApplyRpcArgs(b)).toThrow("invalid_module_position");
  });

  it("refuse plus de 2000 panneaux au total", () => {
    const args = base();
    const one = args._arrays[0]!.modules[0]!;
    args._arrays[0]!.modules = Array.from({ length: 2001 }, () => ({ ...one }));
    expect(() => assertApplyRpcArgs(args)).toThrow("too_many_modules");
  });

  it("refuse une variante dont le nombre annoncé ne correspond pas", () => {
    const args = base();
    args._variant = {
      label: "X",
      strategy: "equilibre",
      orientation_mode: "auto",
      target_mode: "max",
      target_power_kwc: null,
      module_variant_id: "var-1",
      module_snapshot: snapshot,
      rules_profile_id: null,
      rules_profile_version: 3,
      rules_snapshot: RULES,
      layout_engine_version: "2.0.0",
      module_count: 5,
      power_kwc: 1,
      criteria: {},
      modules: [],
    };
    expect(() => assertApplyRpcArgs(args)).toThrow("invalid_variant_module_count");
    args._variant.module_count = 0;
    args._variant.layout_engine_version = "";
    expect(() => assertApplyRpcArgs(args)).toThrow("invalid_variant_engine_version");
  });
});

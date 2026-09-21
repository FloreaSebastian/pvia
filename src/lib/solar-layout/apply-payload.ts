/**
 * Smart PV Layout Engine — charge utile d'application.
 *
 * Module PUR : construit EXACTEMENT ce qui est envoyé à la transaction SQL
 * `solar_apply_layout`. La variante, les champs et les panneaux forment une
 * seule charge utile : il n'existe aucun chemin où la variante serait écrite
 * séparément, donc aucune variante orpheline possible en cas d'échec.
 */
import { validateLayout } from "./validate";
import {
  LAYOUT_ENGINE_VERSION,
  type LayoutCandidate,
  type LayoutModule,
  type LayoutModuleSpec,
  type LayoutPlane,
  type LayoutTarget,
  type OrientationMode,
  type RulesProfile,
} from "./types";

export interface ApplyModulePayload {
  grid_row: number;
  grid_col: number;
  local_u_m: number;
  local_v_m: number;
  orientation: string;
  enabled: boolean;
  validity_status: string;
  validity_cause: string | null;
}

export interface ApplyArrayPayload {
  roof_plane_id: string | null;
  module_variant_id: string;
  module_revision_id: string | null;
  module_snapshot: unknown;
  label: string;
  orientation: string;
  row_gap_m: number;
  col_gap_m: number;
  rules_profile_id: string | null;
  rules_profile_version: number;
  layout_engine_version: string;
  params: { rules: RulesProfile };
  modules: ApplyModulePayload[];
}

export interface ApplyVariantPayload {
  label: string;
  strategy: string;
  orientation_mode: OrientationMode;
  target_mode: LayoutTarget["mode"];
  target_power_kwc: number | null;
  module_variant_id: string;
  module_snapshot: unknown;
  rules_profile_id: string | null;
  rules_profile_version: number;
  rules_snapshot: RulesProfile;
  layout_engine_version: string;
  module_count: number;
  power_kwc: number;
  criteria: unknown;
  modules: LayoutModule[];
}

export interface ApplyRpcArgs {
  _company_id: string;
  _model_id: string;
  _expected_geometry_version: number;
  _arrays: ApplyArrayPayload[];
  /** `null` quand l'utilisateur n'enregistre pas la proposition comme variante. */
  _variant: ApplyVariantPayload | null;
}

/** Sous-ensemble du snapshot catalogue réellement écrit en base. */
export interface ModuleSnapshotRef {
  variant_id: string;
  revision_id: string | null;
}

export function buildVariantPayload(i: {
  label: string;
  candidate: LayoutCandidate;
  moduleVariantId: string;
  snapshot: ModuleSnapshotRef;
  rules: RulesProfile;
  rulesProfileId: string | null;
  target: LayoutTarget;
  orientation: OrientationMode;
}): ApplyVariantPayload {
  return {
    label: i.label,
    strategy: i.candidate.strategy,
    orientation_mode: i.orientation,
    target_mode: i.target.mode,
    target_power_kwc: i.target.power_kwc ?? null,
    module_variant_id: i.moduleVariantId,
    module_snapshot: i.snapshot,
    rules_profile_id: i.rulesProfileId,
    rules_profile_version: i.rules.version,
    rules_snapshot: i.rules,
    layout_engine_version: i.candidate.engine_version,
    module_count: i.candidate.modules.length,
    power_kwc: i.candidate.power_kwc,
    criteria: i.candidate.criteria,
    modules: i.candidate.modules,
  };
}

export function buildArrayPayloads(i: {
  planes: LayoutPlane[];
  modules: LayoutModule[];
  spec: LayoutModuleSpec;
  rules: RulesProfile;
  idByKey: Map<string, string>;
  snapshot: ModuleSnapshotRef;
  rulesProfileId: string | null;
}): ApplyArrayPayload[] {
  const validity = validateLayout(i.planes, i.modules, i.spec, i.rules);
  const statusById = new Map(validity.map((v) => [v.module_id, v]));

  return i.planes.map((plane) => {
    const planeModules = i.modules.filter((m) => m.plane_key === plane.key);
    return {
      roof_plane_id: i.idByKey.get(plane.key) ?? null,
      module_variant_id: i.snapshot.variant_id,
      module_revision_id: i.snapshot.revision_id,
      module_snapshot: i.snapshot,
      label: `Champ ${plane.name}`,
      orientation: planeModules[0]?.orientation ?? "portrait",
      row_gap_m: i.rules.row_gap_m,
      col_gap_m: i.rules.col_gap_m,
      rules_profile_id: i.rulesProfileId,
      rules_profile_version: i.rules.version,
      layout_engine_version: LAYOUT_ENGINE_VERSION,
      params: { rules: i.rules },
      modules: planeModules.map((m) => ({
        grid_row: m.row,
        grid_col: m.col,
        local_u_m: m.u,
        local_v_m: m.v,
        orientation: m.orientation,
        enabled: true,
        validity_status: statusById.get(m.id)?.status ?? "valid",
        validity_cause: statusById.get(m.id)?.cause ?? null,
      })),
    };
  });
}

/** Arguments exacts de l'unique appel transactionnel `solar_apply_layout`. */
export function applyLayoutRpcArgs(i: {
  companyId: string;
  modelId: string;
  geometryVersion: number;
  arrays: ApplyArrayPayload[];
  variant: ApplyVariantPayload | null;
}): ApplyRpcArgs {
  return {
    _company_id: i.companyId,
    _model_id: i.modelId,
    _expected_geometry_version: i.geometryVersion,
    _arrays: i.arrays,
    _variant: i.variant,
  };
}

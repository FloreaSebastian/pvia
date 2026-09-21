/**
 * Solar Studio V2 — P1 : adaptation du modèle enregistré vers la synthèse et le
 * plan technique. Module PUR, partagé par l'interface et le serveur : il n'y a
 * donc qu'UNE seule lecture du modèle, jamais deux vérités différentes.
 */
import { buildPlanDrawing, type PlanDrawing } from "./plan-drawing";
import { buildSolarResults, readModuleSpec, type SolarResultsReport } from "./results";
import type { LocalPoint } from "./geo";
import type { PlacedModule } from "./types";

export interface ReportModelLike {
  model: {
    name: string;
    address: string;
    postal_code: string;
    city: string;
    geometry_version: number;
    geometry_hash: string | null;
    updated_at?: string | null;
    quality_level: string;
  };
  planes: {
    id: string;
    key: string;
    name: string;
    area_m2: number;
    azimuth_deg: number;
    tilt_deg: number;
    polygon: LocalPoint[];
  }[];
  modules: PlacedModule[];
  obstacles: {
    id: string;
    roof_plane_id: string | null;
    obstacle_type: string;
    label?: string | null;
    position_x_m: number;
    position_y_m: number;
    width_m: number;
    length_m: number;
  }[];
  arrays: {
    roof_plane_id: string;
    module_snapshot?: unknown;
    module_variant_id?: string | null;
    module_revision_id?: string | null;
    rules_profile_id?: string | null;
    rules_profile_version?: number | null;
    layout_engine_version?: string | null;
  }[];
  quality?: { verified_count: number; total_count: number } | null;
}

export function formatModelAddress(model: ReportModelLike["model"]): string {
  return [model.address, `${model.postal_code} ${model.city}`.trim()].filter(Boolean).join(", ");
}

export function resultsFromModel(payload: ReportModelLike): SolarResultsReport {
  return buildSolarResults({
    model: {
      reference: null,
      name: payload.model.name,
      address: formatModelAddress(payload.model),
      geometry_version: payload.model.geometry_version,
      geometry_hash: payload.model.geometry_hash,
      updated_at: payload.model.updated_at ?? null,
      quality_level: payload.model.quality_level,
    },
    planes: payload.planes,
    modules: payload.modules,
    obstacles: payload.obstacles,
    arrays: payload.arrays,
    quality: payload.quality ?? null,
  });
}

export function drawingFromModel(
  payload: ReportModelLike,
  opts: { title: string; subtitle?: string } = { title: "Plan d'implantation photovoltaïque" },
): PlanDrawing {
  const planeById = new Map(payload.planes.map((p) => [p.id, p]));
  const spec = readModuleSpec(payload.arrays[0]?.module_snapshot);
  return buildPlanDrawing({
    planes: payload.planes.map((p) => ({
      key: p.key,
      name: p.name,
      polygon: p.polygon,
      azimuth_deg: p.azimuth_deg,
      tilt_deg: p.tilt_deg,
    })),
    modules: payload.modules,
    obstacles: payload.obstacles.map((o) => ({
      id: o.id,
      planeKey: o.roof_plane_id ? (planeById.get(o.roof_plane_id)?.key ?? null) : null,
      u: o.position_x_m,
      v: o.position_y_m,
      width: o.width_m,
      length: o.length_m,
      label: o.label ?? o.obstacle_type,
    })),
    spec:
      spec.width_mm !== null && spec.height_mm !== null
        ? { width_mm: spec.width_mm, height_mm: spec.height_mm }
        : null,
    title: opts.title,
    subtitle: opts.subtitle,
  });
}

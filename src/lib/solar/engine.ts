/**
 * Solar Studio — contrat avec le moteur géospatial externe (PVIA Geospatial Engine).
 *
 * Module PUR : conversion du résultat `roof-model-v1` vers la géométrie interne
 * de Solar Studio, différences chiffrées, libellés d'état. Aucune donnée n'est
 * inventée : si le moteur n'est pas configuré, l'état le dit explicitement.
 */
import type { LocalPoint } from "./geo";
import type { PlaneFrame, RoofPlaneGeometry } from "./types";

export const ENGINE_RESULT_SCHEMA = "roof-model-v1";

export type EngineState = "not_configured" | "unreachable" | "degraded" | "ready";

export const ENGINE_STATE_LABEL: Record<EngineState, string> = {
  not_configured: "Service de traitement 3D non configuré",
  unreachable: "Analyse 3D temporairement indisponible",
  degraded: "Service de traitement 3D incomplet",
  ready: "Service de traitement 3D disponible",
};

export type DatasetState = "available" | "unavailable_here" | "service_unavailable" | "processing_required";

export const DATASET_STATE_LABEL: Record<DatasetState, string> = {
  available: "Disponible",
  unavailable_here: "Indisponible sur cette zone",
  service_unavailable: "Service indisponible",
  processing_required: "Traitement requis",
};

export interface EngineHealth {
  status: "ok" | "degraded";
  version: string;
  protocol_version: string;
  pipeline_version: string;
  result_schema_version: string;
  pdal_version: string | null;
  gdal_version: string | null;
  proj_version: string | null;
}

export interface EngineDatasetStatus {
  dataset_kind: string;
  label: string;
  state: DatasetState;
  provider: string | null;
  dataset: string | null;
  resolution_m: number | null;
  attribution: string | null;
  notes: string;
}

export interface EngineRoofPlane {
  index: number;
  normal: [number, number, number];
  plane_d: number;
  tilt_deg: number;
  azimuth_deg: number;
  centroid: [number, number, number];
  mean_height_m: number;
  min_height_m: number;
  max_height_m: number;
  area_m2: number;
  contour: [number, number, number][];
  point_count: number;
  rejected_points: number;
  density_pts_m2: number;
  rmse_m: number;
  max_error_m: number;
  dispersion_m: number;
  confidence: "high" | "medium" | "low";
  confidence_reasons: string[];
}

export interface EngineObstacle {
  kind: "obstacle" | "vegetation";
  position: [number, number, number];
  height_m: number;
  width_m: number;
  length_m: number;
  point_count: number;
  confidence: string;
}

export interface EngineRoofModel {
  result_schema_version: string;
  engine_version: string;
  pipeline_version: string;
  azimuth_convention: string;
  origin: { latitude: number; longitude: number; altitude_m: number; working_crs: string; source_crs: string };
  planes: EngineRoofPlane[];
  edges: {
    kind: string;
    plane_indices: number[];
    start: [number, number, number];
    end: [number, number, number];
    length_m: number;
    status: "derived" | "to_confirm";
  }[];
  obstacles: EngineObstacle[];
  terrain: {
    available: boolean;
    origin_altitude_m?: number | null;
    min_m?: number | null;
    max_m?: number | null;
    grid_step_m?: number | null;
    heights?: number[];
    cols?: number | null;
    rows?: number | null;
  };
  building_envelope: [number, number][];
  point_cloud_preview: [number, number, number][];
  point_cloud_classification: number[];
  classification_legend: Record<string, string>;
  metrics: Record<string, number | string | boolean | null>;
  sources: {
    provider: string;
    dataset: string;
    dataset_kind: string;
    acquisition_date: string | null;
    crs: string;
    resolution_m: number | null;
    attribution: string;
    license: string;
  }[];
}

/** Validation défensive : un résultat au mauvais schéma n'est jamais appliqué. */
export function isEngineRoofModel(value: unknown): value is EngineRoofModel {
  const v = value as EngineRoofModel | null;
  return (
    !!v &&
    typeof v === "object" &&
    v.result_schema_version === ENGINE_RESULT_SCHEMA &&
    Array.isArray(v.planes) &&
    !!v.origin
  );
}

type Vec3 = [number, number, number];

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function unit(v: Vec3): Vec3 {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
}

/**
 * Convertit un pan détecté en géométrie Solar Studio ({ key, points, frame }),
 * afin que la scène 3D, l'implantation et les mesures fonctionnent à l'identique.
 */
export function enginePlaneToGeometry(plane: EngineRoofPlane): RoofPlaneGeometry | null {
  if (!plane.contour || plane.contour.length < 3) return null;
  const n = unit(plane.normal);
  // u : horizontal, le long de l'égout ; v : monte la pente.
  let u = cross([0, 0, 1], n);
  if (Math.hypot(u[0], u[1], u[2]) < 1e-6) u = [1, 0, 0];
  u = unit(u);
  const v = unit(cross(n, u));

  const ref = plane.contour[0] as Vec3;
  const projected = plane.contour.map((p) => {
    const d = sub(p as Vec3, ref);
    return { u: dot(d, u), v: dot(d, v) };
  });
  const minU = Math.min(...projected.map((p) => p.u));
  const minV = Math.min(...projected.map((p) => p.v));
  const origin: Vec3 = [
    ref[0] + u[0] * minU + v[0] * minV,
    ref[1] + u[1] * minU + v[1] * minV,
    ref[2] + u[2] * minU + v[2] * minV,
  ];
  const polygon: LocalPoint[] = projected.map((p) => ({ x: p.u - minU, y: p.v - minV }));
  const frame: PlaneFrame = { origin, u, v, normal: n };

  const heights = plane.contour.map((p) => p[2]);
  return {
    key: `lidar-${plane.index}`,
    name: planeName(plane),
    azimuth_deg: plane.azimuth_deg,
    tilt_deg: plane.tilt_deg,
    area_m2: plane.area_m2,
    polygon,
    frame,
    eave_height_m: Math.min(...heights),
    ridge_height_m: Math.max(...heights),
  };
}

const CARDINALS: [number, string][] = [
  [0, "Nord"],
  [45, "Nord-Est"],
  [90, "Est"],
  [135, "Sud-Est"],
  [180, "Sud"],
  [225, "Sud-Ouest"],
  [270, "Ouest"],
  [315, "Nord-Ouest"],
];

export function cardinalLabel(azimuthDeg: number): string {
  const a = ((azimuthDeg % 360) + 360) % 360;
  let best = CARDINALS[0]!;
  let bestDelta = 360;
  for (const entry of CARDINALS) {
    const delta = Math.abs(((a - entry[0] + 180) % 360) - 180);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = entry;
    }
  }
  return best[1];
}

export function planeName(plane: EngineRoofPlane): string {
  return `Pan ${cardinalLabel(plane.azimuth_deg)}`;
}

export interface EngineDiffRow {
  label: string;
  current: string;
  proposed: string;
  delta: string | null;
}

export interface CurrentGeometrySummary {
  plane_count: number;
  total_area_m2: number;
  main_tilt_deg: number | null;
  main_azimuth_deg: number | null;
  ridge_height_m: number | null;
}

const fmt = (n: number, digits = 2) => n.toFixed(digits).replace(".", ",");

/** Différences chiffrées, sans désigner de gagnant automatique. */
export function compareWithEngine(current: CurrentGeometrySummary, model: EngineRoofModel): EngineDiffRow[] {
  const rows: EngineDiffRow[] = [];
  const proposedArea = model.planes.reduce((s, p) => s + p.area_m2, 0);
  rows.push({
    label: "Nombre de pans",
    current: String(current.plane_count),
    proposed: String(model.planes.length),
    delta: model.planes.length === current.plane_count ? null : `${current.plane_count} → ${model.planes.length}`,
  });
  rows.push({
    label: "Surface de toiture",
    current: `${fmt(current.total_area_m2)} m²`,
    proposed: `${fmt(proposedArea)} m²`,
    delta: `${proposedArea - current.total_area_m2 >= 0 ? "+" : ""}${fmt(proposedArea - current.total_area_m2)} m²`,
  });

  const main = [...model.planes].sort((a, b) => b.area_m2 - a.area_m2)[0];
  if (main) {
    if (current.main_tilt_deg != null) {
      rows.push({
        label: "Inclinaison du pan principal",
        current: `${fmt(current.main_tilt_deg, 1)}°`,
        proposed: `${fmt(main.tilt_deg, 2)}°`,
        delta: `${main.tilt_deg - current.main_tilt_deg >= 0 ? "+" : ""}${fmt(main.tilt_deg - current.main_tilt_deg, 2)}°`,
      });
    }
    if (current.main_azimuth_deg != null) {
      const delta = ((main.azimuth_deg - current.main_azimuth_deg + 540) % 360) - 180;
      rows.push({
        label: "Azimut du pan principal",
        current: `${fmt(current.main_azimuth_deg, 1)}°`,
        proposed: `${fmt(main.azimuth_deg, 1)}°`,
        delta: `${delta >= 0 ? "+" : ""}${fmt(delta, 1)}°`,
      });
    }
  }

  const ridge = model.planes.length ? Math.max(...model.planes.map((p) => p.max_height_m)) : null;
  if (ridge != null && current.ridge_height_m != null) {
    rows.push({
      label: "Hauteur de faîtage",
      current: `${fmt(current.ridge_height_m)} m`,
      proposed: `${fmt(ridge)} m`,
      delta: `${ridge - current.ridge_height_m >= 0 ? "+" : ""}${fmt(ridge - current.ridge_height_m)} m`,
    });
  }
  return rows;
}

/**
 * Qualité affichée : source, métriques réelles et confiance.
 * Jamais de label du type « précision 10 cm » : la précision documentée d'une
 * source ne garantit pas celle de la géométrie reconstruite.
 */
export function planeQualityLine(plane: EngineRoofPlane, source: string): string {
  return [
    source,
    `${plane.point_count} points`,
    `RMSE ${(plane.rmse_m * 100).toFixed(1)} cm`,
    `confiance ${plane.confidence === "high" ? "élevée" : plane.confidence === "medium" ? "moyenne" : "faible"}`,
    "non vérifié terrain",
  ].join(" · ");
}

/**
 * Solar Studio V2 — P1 : synthèse « Résultats ».
 *
 * Module PUR. Il n'invente AUCUNE donnée : toutes les valeurs proviennent du
 * modèle enregistré (pans, modules posés, snapshot panneau des champs).
 * Aucune production annuelle ni ombrage n'est estimé ici : aucun moteur
 * d'irradiance n'existe à ce stade (cf. `production: null`).
 */
import { azimuthLabel } from "./geo";
import type { PlacedModule } from "./types";

export interface ResultsModelRef {
  reference: string | null;
  name: string | null;
  address: string | null;
  geometry_version: number;
  geometry_hash: string | null;
  updated_at: string | null;
  quality_level: string | null;
}

export interface ResultsPlaneRef {
  id: string;
  key: string;
  name: string;
  area_m2: number;
  azimuth_deg: number;
  tilt_deg: number;
}

export interface ResultsObstacleRef {
  roof_plane_id: string | null;
  obstacle_type: string;
  label?: string | null;
}

export interface ResultsArrayRef {
  roof_plane_id: string;
  module_variant_id?: string | null;
  module_revision_id?: string | null;
  module_snapshot?: unknown;
  rules_profile_id?: string | null;
  rules_profile_version?: number | null;
  layout_engine_version?: string | null;
}

export interface ResultsInput {
  model: ResultsModelRef;
  planes: ResultsPlaneRef[];
  modules: PlacedModule[];
  obstacles: ResultsObstacleRef[];
  arrays: ResultsArrayRef[];
  /** Fiche qualité/provenance déjà calculée par le serveur (jamais recalculée ici). */
  quality?: { verified_count: number; total_count: number } | null;
}

export interface ModuleSpecRef {
  manufacturer: string | null;
  model: string | null;
  power_wc: number | null;
  width_mm: number | null;
  height_mm: number | null;
  depth_mm: number | null;
  /** Vrai si dimensions ET puissance sont présentes : sinon le dossier est incomplet. */
  complete: boolean;
}

export interface PlaneResult {
  key: string;
  name: string;
  area_m2: number;
  tilt_deg: number;
  azimuth_deg: number;
  cardinal: string;
  module_count: number;
  power_kwc: number;
  module_area_m2: number;
  obstacles: string[];
  alerts: string[];
}

export interface ResultsWarning {
  code:
    | "aucun_panneau"
    | "pan_sans_panneau"
    | "snapshot_incomplet"
    | "panneaux_desactives"
    | "provenance_a_verifier"
    | "geometrie_non_verifiee";
  message: string;
}

export interface SolarResultsReport {
  global: {
    power_kwc: number;
    module_count: number;
    spec: ModuleSpecRef;
    module_area_m2: number;
    roof_area_m2: number;
    planes_used: number;
    orientations: string[];
    status: "ok" | "alerte";
  };
  planes: PlaneResult[];
  technical: {
    geometry_version: number;
    geometry_hash_short: string | null;
    module_variant_id: string | null;
    module_revision_id: string | null;
    module_snapshot: Record<string, unknown> | null;
    rules_profile_id: string | null;
    rules_profile_version: number | null;
    layout_engine_version: string | null;
    updated_at: string | null;
    quality_level: string | null;
    quality_verified: string | null;
  };
  warnings: ResultsWarning[];
  /** Aucun moteur de production/irradiance n'existe : le champ reste `null`. */
  production: null;
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Dimensions/identité du panneau, exclusivement issues du snapshot du champ. */
export function readModuleSpec(snapshot: unknown): ModuleSpecRef {
  const s = (snapshot && typeof snapshot === "object" ? snapshot : {}) as Record<string, unknown>;
  const spec: ModuleSpecRef = {
    manufacturer: str(s["manufacturer"]),
    model: str(s["model"]) ?? str(s["reference"]) ?? str(s["series"]),
    power_wc: num(s["power_wc"]),
    width_mm: num(s["width_mm"]),
    height_mm: num(s["height_mm"]),
    depth_mm: num(s["depth_mm"]),
    complete: false,
  };
  spec.complete =
    spec.width_mm !== null &&
    spec.height_mm !== null &&
    spec.power_wc !== null &&
    spec.manufacturer !== null &&
    spec.model !== null;
  return spec;
}

/** Surface au sol d'un panneau, en m², selon son orientation de pose. */
function moduleArea(spec: ModuleSpecRef): number {
  if (spec.width_mm === null || spec.height_mm === null) return 0;
  return (spec.width_mm / 1000) * (spec.height_mm / 1000);
}

export function buildSolarResults(input: ResultsInput): SolarResultsReport {
  const active = input.modules.filter((m) => m.enabled);
  const disabled = input.modules.length - active.length;

  const planeById = new Map(input.planes.map((p) => [p.id, p]));
  const mainArray = input.arrays[0] ?? null;
  const spec = readModuleSpec(mainArray?.module_snapshot);
  const unitArea = moduleArea(spec);
  const unitKwc = (spec.power_wc ?? 0) / 1000;

  const obstaclesByPlane = new Map<string, string[]>();
  for (const o of input.obstacles) {
    const plane = o.roof_plane_id ? planeById.get(o.roof_plane_id) : null;
    if (!plane) continue;
    const list = obstaclesByPlane.get(plane.key) ?? [];
    list.push(str(o.label) ?? o.obstacle_type);
    obstaclesByPlane.set(plane.key, list);
  }

  const planes: PlaneResult[] = input.planes.map((p) => {
    const mine = active.filter((m) => m.roof_plane_key === p.key);
    const alerts: string[] = [];
    if (mine.length === 0) alerts.push("Aucun panneau posé sur ce pan.");
    return {
      key: p.key,
      name: p.name,
      area_m2: round(p.area_m2, 1),
      tilt_deg: round(p.tilt_deg, 1),
      azimuth_deg: round(p.azimuth_deg, 1),
      cardinal: azimuthLabel(p.azimuth_deg),
      module_count: mine.length,
      power_kwc: round(mine.length * unitKwc, 2),
      module_area_m2: round(mine.length * unitArea, 1),
      obstacles: obstaclesByPlane.get(p.key) ?? [],
      alerts,
    };
  });

  const orientations = [...new Set(active.map((m) => m.orientation))].sort();
  const planesUsed = planes.filter((p) => p.module_count > 0).length;

  const warnings: ResultsWarning[] = [];
  if (active.length === 0) {
    warnings.push({ code: "aucun_panneau", message: "Aucun panneau posé sur cette toiture." });
  }
  for (const p of planes) {
    if (p.module_count === 0) {
      warnings.push({ code: "pan_sans_panneau", message: `${p.name} : aucun panneau posé.` });
    }
  }
  if (active.length > 0 && !spec.complete) {
    warnings.push({
      code: "snapshot_incomplet",
      message: "Fiche du panneau incomplète : vérifiez la référence enregistrée.",
    });
  }
  if (disabled > 0) {
    warnings.push({
      code: "panneaux_desactives",
      message: `${disabled} panneau${disabled > 1 ? "x" : ""} désactivé${disabled > 1 ? "s" : ""} : non compté${disabled > 1 ? "s" : ""} dans la puissance.`,
    });
  }
  if (input.quality && input.quality.total_count > input.quality.verified_count) {
    warnings.push({
      code: "provenance_a_verifier",
      message: `${input.quality.total_count - input.quality.verified_count} donnée(s) non vérifiée(s) sur site.`,
    });
  }

  const snapshot =
    mainArray?.module_snapshot && typeof mainArray.module_snapshot === "object"
      ? (mainArray.module_snapshot as Record<string, unknown>)
      : null;

  return {
    global: {
      power_kwc: round(active.length * unitKwc, 2),
      module_count: active.length,
      spec,
      module_area_m2: round(active.length * unitArea, 1),
      roof_area_m2: round(
        input.planes.reduce((s, p) => s + p.area_m2, 0),
        1,
      ),
      planes_used: planesUsed,
      orientations,
      status: warnings.some((w) => w.code === "aucun_panneau" || w.code === "snapshot_incomplet")
        ? "alerte"
        : "ok",
    },
    planes,
    technical: {
      geometry_version: input.model.geometry_version,
      geometry_hash_short: input.model.geometry_hash
        ? input.model.geometry_hash.slice(0, 12)
        : null,
      module_variant_id: mainArray?.module_variant_id ?? null,
      module_revision_id: mainArray?.module_revision_id ?? null,
      module_snapshot: snapshot,
      rules_profile_id: mainArray?.rules_profile_id ?? null,
      rules_profile_version: mainArray?.rules_profile_version ?? null,
      layout_engine_version: mainArray?.layout_engine_version ?? null,
      updated_at: input.model.updated_at,
      quality_level: input.model.quality_level,
      quality_verified: input.quality
        ? `${input.quality.verified_count}/${input.quality.total_count}`
        : null,
    },
    warnings,
    production: null,
  };
}

/** Nom de fichier d'export, normalisé et sans caractère hasardeux. */
export function planExportFileName(reference: string | null, date: Date, ext: string): string {
  const ref = (reference ?? "dossier")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const iso = date.toISOString().slice(0, 10);
  return `PVIA_${ref || "dossier"}_plan-photovoltaique_${iso}.${ext}`;
}

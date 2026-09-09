/**
 * Solar Studio — comparaison de géométries et répercussion sur les panneaux.
 *
 * Module PUR. Aucune décision automatique : on produit des différences lisibles,
 * l'utilisateur choisit « Appliquer » ou « Conserver l'actuel ».
 */
import { pointInPolygon } from "./geo";
import type { BuildingParams, PlacedModule, RoofPlaneGeometry } from "./types";

export interface GeometryChange {
  label: string;
  before: string;
  after: string;
  /** Écart numérique quand il a un sens (mètres, degrés, m²). */
  delta: number | null;
  unit: "m" | "deg" | "m2" | "count" | null;
}

export interface GeometrySnapshotLite {
  params: BuildingParams;
  planes: Pick<RoofPlaneGeometry, "key" | "name" | "azimuth_deg" | "tilt_deg" | "area_m2" | "ridge_height_m">[];
}

const fmt = (v: number, digits = 2) => v.toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Différences compréhensibles entre le modèle actuel et un modèle proposé. */
export function compareGeometry(current: GeometrySnapshotLite, proposed: GeometrySnapshotLite): GeometryChange[] {
  const changes: GeometryChange[] = [];

  const push = (label: string, a: number, b: number, unit: GeometryChange["unit"], digits = 2) => {
    if (Math.abs(a - b) < 1e-6) return;
    changes.push({
      label,
      before: `${fmt(a, digits)}${unit === "deg" ? "°" : unit === "m2" ? " m²" : unit === "m" ? " m" : ""}`,
      after: `${fmt(b, digits)}${unit === "deg" ? "°" : unit === "m2" ? " m²" : unit === "m" ? " m" : ""}`,
      delta: b - a,
      unit,
    });
  };

  if (current.planes.length !== proposed.planes.length) {
    changes.push({
      label: "Nombre de pans",
      before: String(current.planes.length),
      after: String(proposed.planes.length),
      delta: proposed.planes.length - current.planes.length,
      unit: "count",
    });
  }

  push("Largeur", current.params.width_m, proposed.params.width_m, "m");
  push("Profondeur", current.params.depth_m, proposed.params.depth_m, "m");
  push("Hauteur au mur", current.params.wall_height_m, proposed.params.wall_height_m, "m");
  push("Pente", current.params.tilt_deg, proposed.params.tilt_deg, "deg", 1);
  push("Azimut", current.params.azimuth_deg, proposed.params.azimuth_deg, "deg", 1);

  const areaA = current.planes.reduce((s, p) => s + p.area_m2, 0);
  const areaB = proposed.planes.reduce((s, p) => s + p.area_m2, 0);
  push("Surface de toiture", areaA, areaB, "m2");

  const ridgeA = Math.max(0, ...current.planes.map((p) => p.ridge_height_m));
  const ridgeB = Math.max(0, ...proposed.planes.map((p) => p.ridge_height_m));
  push("Hauteur au faîtage", ridgeA, ridgeB, "m");

  for (const before of current.planes) {
    const after = proposed.planes.find((p) => p.key === before.key);
    if (!after) continue;
    push(`${before.name} — pente`, before.tilt_deg, after.tilt_deg, "deg", 1);
    push(`${before.name} — surface`, before.area_m2, after.area_m2, "m2");
  }

  return changes;
}

export type ModuleValidity = "ok" | "outside" | "orphan";

export interface ModuleRevalidation {
  module_id: string;
  plane_key: string;
  status: ModuleValidity;
}

export interface RevalidationResult {
  entries: ModuleRevalidation[];
  invalid_count: number;
  /** Identifiants à marquer visuellement. Aucune suppression automatique. */
  invalid_ids: string[];
}

/**
 * Vérifie que chaque panneau reste sur son pan après modification de la toiture.
 * On NE supprime jamais : on signale les panneaux à repositionner.
 */
export function revalidateModules(
  planes: Pick<RoofPlaneGeometry, "key" | "polygon">[],
  modules: PlacedModule[],
): RevalidationResult {
  const byKey = new Map(planes.map((p) => [p.key, p]));
  const entries: ModuleRevalidation[] = modules.map((m) => {
    const plane = byKey.get(m.roof_plane_key);
    if (!plane) return { module_id: m.id, plane_key: m.roof_plane_key, status: "orphan" as const };
    const inside = pointInPolygon({ x: m.local_u_m, y: m.local_v_m }, plane.polygon);
    return { module_id: m.id, plane_key: m.roof_plane_key, status: inside ? ("ok" as const) : ("outside" as const) };
  });
  const invalid = entries.filter((e) => e.status !== "ok");
  return { entries, invalid_count: invalid.length, invalid_ids: invalid.map((e) => e.module_id) };
}

/** Message utilisateur, au singulier ou au pluriel, jamais alarmiste sans raison. */
export function revalidationMessage(result: RevalidationResult): string | null {
  if (!result.invalid_count) return null;
  return result.invalid_count === 1
    ? "1 panneau doit être repositionné."
    : `${result.invalid_count} panneaux doivent être repositionnés.`;
}

/**
 * Solar Studio — implantation des modules sur un pan.
 *
 * Module PUR : aucune dépendance 3D. Les contraintes (reculs, écartements,
 * obstacles, zones interdites) sont des paramètres, jamais des constantes
 * cachées dans le code d'affichage.
 */
import { pointInPolygon, polygonArea, type LocalPoint } from "./geo";
import type { ModuleOrientation, PlacedModule, RoofPlaneGeometry, SolarModuleSpec } from "./types";

/** Emprise rectangulaire d'un obstacle, exprimée dans le repère (u,v) du pan. */
export interface PlaneObstacle {
  id: string;
  u: number;
  v: number;
  width_m: number;
  length_m: number;
  clearance_m: number;
}

export interface LayoutConstraints {
  /** Recul minimal par rapport aux bords du pan (rive, égout, faîtage). */
  setback_m: number;
  row_gap_m: number;
  col_gap_m: number;
  orientation: ModuleOrientation;
  /** Zones où la pose est interdite, en coordonnées (u,v). */
  forbidden: LocalPoint[][];
  /** Si renseigné, la pose est limitée à ces zones. */
  allowed?: LocalPoint[][];
  max_modules?: number;
}

export const DEFAULT_CONSTRAINTS: LayoutConstraints = {
  setback_m: 0.4,
  row_gap_m: 0.02,
  col_gap_m: 0.02,
  orientation: "portrait",
  forbidden: [],
};

export function moduleFootprint(
  spec: Pick<SolarModuleSpec, "width_mm" | "height_mm">,
  orientation: ModuleOrientation,
): { width: number; length: number } {
  const w = spec.width_mm / 1000;
  const h = spec.height_mm / 1000;
  return orientation === "portrait" ? { width: w, length: h } : { width: h, length: w };
}

function bbox(points: LocalPoint[]) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function cornersOf(cu: number, cv: number, width: number, length: number): LocalPoint[] {
  const hw = width / 2;
  const hl = length / 2;
  return [
    { x: cu - hw, y: cv - hl },
    { x: cu + hw, y: cv - hl },
    { x: cu + hw, y: cv + hl },
    { x: cu - hw, y: cv + hl },
  ];
}

/** Distance signée minimale d'un point au bord du polygone (négatif à l'extérieur). */
function insidePolygonWithMargin(corners: LocalPoint[], polygon: LocalPoint[]): boolean {
  return corners.every((c) => pointInPolygon(c, polygon));
}

function overlapsRect(
  cu: number,
  cv: number,
  width: number,
  length: number,
  obstacle: PlaneObstacle,
): boolean {
  const pad = Math.max(0, obstacle.clearance_m);
  const ow = obstacle.width_m / 2 + pad;
  const ol = obstacle.length_m / 2 + pad;
  return Math.abs(cu - obstacle.u) < width / 2 + ow && Math.abs(cv - obstacle.v) < length / 2 + ol;
}

function inAnyPolygon(corners: LocalPoint[], polygons: LocalPoint[][]): boolean {
  return polygons.some((poly) => corners.some((c) => pointInPolygon(c, poly)));
}

/**
 * Implantation en grille alignée sur l'égout du pan.
 * Retourne les modules réellement posables, ligne par ligne, du bas vers le haut.
 */
export function gridLayout(
  plane: Pick<RoofPlaneGeometry, "key" | "polygon">,
  spec: Pick<SolarModuleSpec, "width_mm" | "height_mm">,
  obstacles: PlaneObstacle[],
  constraints: LayoutConstraints = DEFAULT_CONSTRAINTS,
): Omit<PlacedModule, "id">[] {
  const { width, length } = moduleFootprint(spec, constraints.orientation);
  if (width <= 0 || length <= 0) return [];

  const box = bbox(plane.polygon);
  const setback = Math.max(0, constraints.setback_m);
  const stepU = width + Math.max(0, constraints.col_gap_m);
  const stepV = length + Math.max(0, constraints.row_gap_m);

  const startU = box.minX + setback + width / 2;
  const startV = box.minY + setback + length / 2;
  const limitU = box.maxX - setback - width / 2;
  const limitV = box.maxY - setback - length / 2;

  const inset = insetPolygon(plane.polygon, setback);
  const placed: Omit<PlacedModule, "id">[] = [];

  let row = 0;
  for (let cv = startV; cv <= limitV + 1e-9; cv += stepV, row += 1) {
    let col = 0;
    for (let cu = startU; cu <= limitU + 1e-9; cu += stepU, col += 1) {
      if (constraints.max_modules && placed.length >= constraints.max_modules) return placed;
      const corners = cornersOf(cu, cv, width, length);
      if (!insidePolygonWithMargin(corners, inset)) continue;
      if (obstacles.some((o) => overlapsRect(cu, cv, width, length, o))) continue;
      if (constraints.forbidden.length && inAnyPolygon(corners, constraints.forbidden)) continue;
      if (constraints.allowed?.length && !constraints.allowed.some((poly) => corners.every((c) => pointInPolygon(c, poly))))
        continue;
      placed.push({
        roof_plane_key: plane.key,
        grid_row: row,
        grid_col: col,
        local_u_m: round(cu),
        local_v_m: round(cv),
        orientation: constraints.orientation,
        enabled: true,
      });
    }
  }
  return placed;
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/**
 * Rétrécit un polygone convexe ou légèrement concave d'une marge constante,
 * par déplacement des sommets vers le centroïde pondéré par la marge.
 * Suffisant pour les toitures paramétriques (rectangles, trapèzes, triangles).
 */
export function insetPolygon(polygon: LocalPoint[], margin: number): LocalPoint[] {
  if (margin <= 0 || polygon.length < 3) return polygon;
  const area = polygonArea(polygon);
  if (area <= 0) return polygon;
  const cx = polygon.reduce((s, p) => s + p.x, 0) / polygon.length;
  const cy = polygon.reduce((s, p) => s + p.y, 0) / polygon.length;
  return polygon.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const d = Math.hypot(dx, dy) || 1;
    const k = Math.max(0, (d - margin) / d);
    return { x: cx + dx * k, y: cy + dy * k };
  });
}

/** Puissance crête d'un ensemble de modules, en kWc. */
export function powerKwc(count: number, powerWc: number): number {
  return Math.round(((count * powerWc) / 1000) * 100) / 100;
}

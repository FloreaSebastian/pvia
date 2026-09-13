/**
 * Smart PV Layout Engine — zone exploitable d'un pan.
 *
 * Zone exploitable = contour du pan
 *   − recul égout / faîtage / rive (profil de règles)
 *   − obstacles dilatés de leur marge
 *   − zones interdites, passages techniques, réservations
 *
 * Les zones prioritaires ne filtrent rien : elles sont conservées comme
 * préférence pour le scoring.
 */
import {
  bbox,
  offsetPolygon,
  polygonArea,
  rectIntersectsPolygon,
  rectInsidePolygon,
  rectsOverlap,
  toCCW,
  type Rect,
} from "./geometry";
import type { LayoutObstacle, LayoutPlane, Pt, RulesProfile } from "./types";

export type EdgeKind = "egout" | "faitage" | "rive";

/** Classe chaque arête du pan : bas de pente = égout, haut = faîtage, sinon rive. */
export function classifyEdges(poly: Pt[]): EdgeKind[] {
  const p = toCCW(poly);
  const box = bbox(p);
  const tol = Math.max(0.05, (box.maxY - box.minY) * 0.02);
  return p.map((a, i) => {
    const b = p[(i + 1) % p.length]!;
    const midY = (a.y + b.y) / 2;
    const horizontal = Math.abs(a.y - b.y) <= tol;
    if (horizontal && midY - box.minY <= tol) return "egout";
    if (horizontal && box.maxY - midY <= tol) return "faitage";
    return "rive";
  });
}

export function edgeMargins(poly: Pt[], rules: RulesProfile): number[] {
  return classifyEdges(poly).map((kind) =>
    kind === "egout" ? rules.eave_m : kind === "faitage" ? rules.ridge_m : rules.verge_m,
  );
}

const BLOCKING_ZONES = new Set(["interdite", "passage", "technique", "reservee"]);

export interface UsableArea {
  plane_key: string;
  /** Contour utile après reculs. */
  boundary: Pt[];
  /** Emprises interdites (obstacles dilatés). */
  blockedRects: Rect[];
  /** Polygones interdits (zones dessinées). */
  blockedPolygons: Pt[][];
  /** Zones à privilégier. */
  priorityPolygons: Pt[][];
  area_m2: number;
}

export function obstacleRect(o: LayoutObstacle, rules: RulesProfile): Rect {
  const pad = (o.clearance_m ?? rules.obstacle_m) * 2;
  return { u: o.u, v: o.v, width: Math.max(0, o.width_m) + pad, length: Math.max(0, o.length_m) + pad };
}

export function buildUsableArea(plane: LayoutPlane, rules: RulesProfile): UsableArea {
  const boundary = offsetPolygon(plane.polygon, edgeMargins(plane.polygon, rules));
  const blockedRects = plane.obstacles.map((o) => obstacleRect(o, rules));
  const blockedPolygons = plane.zones.filter((z) => BLOCKING_ZONES.has(z.type)).map((z) => toCCW(z.polygon));
  const priorityPolygons = plane.zones.filter((z) => z.type === "prioritaire").map((z) => toCCW(z.polygon));

  let area = boundary.length >= 3 ? polygonArea(boundary) : 0;
  for (const r of blockedRects) area -= r.width * r.length;
  for (const p of blockedPolygons) area -= polygonArea(p);

  return {
    plane_key: plane.key,
    boundary,
    blockedRects,
    blockedPolygons,
    priorityPolygons,
    area_m2: Math.max(0, area),
  };
}

/** Un rectangle de module peut-il être posé ? */
export function canPlace(area: UsableArea, rect: Rect): boolean {
  if (area.boundary.length < 3) return false;
  if (!rectInsidePolygon(rect, area.boundary)) return false;
  if (area.blockedRects.some((b) => rectsOverlap(rect, b))) return false;
  if (area.blockedPolygons.some((p) => rectIntersectsPolygon(rect, p))) return false;
  return true;
}

export function inPriorityZone(area: UsableArea, rect: Rect): boolean {
  return area.priorityPolygons.some((p) => rectIntersectsPolygon(rect, p));
}

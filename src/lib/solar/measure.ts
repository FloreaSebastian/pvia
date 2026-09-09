/**
 * Solar Studio — mesures et accrochage (snapping).
 *
 * Module PUR. Toutes les valeurs sont calculées en pleine précision, en mètres
 * ou en degrés. L'arrondi appartient exclusivement à l'affichage (units.ts).
 */
import type { LocalPoint } from "./geo";
import type { RoofPlaneGeometry } from "./types";
import { planePointToWorld } from "./roof";

export type Vec3 = [number, number, number];

export type MeasureKind =
  | "distance"
  | "distance_horizontal"
  | "distance_3d"
  | "height"
  | "elevation_delta"
  | "angle"
  | "slope"
  | "area";

export const MEASURE_META: Record<MeasureKind, { label: string; points: number; unit: "m" | "m2" | "deg" }> = {
  distance: { label: "Distance", points: 2, unit: "m" },
  distance_horizontal: { label: "Distance horizontale", points: 2, unit: "m" },
  distance_3d: { label: "Distance 3D", points: 2, unit: "m" },
  height: { label: "Hauteur", points: 2, unit: "m" },
  elevation_delta: { label: "Dénivelé", points: 2, unit: "m" },
  angle: { label: "Angle", points: 3, unit: "deg" },
  slope: { label: "Pente", points: 2, unit: "deg" },
  area: { label: "Surface", points: 3, unit: "m2" },
};

export type MeasureCategory = "largeur" | "longueur" | "hauteur" | "distance_obstacle" | "distance_rive" | "autre";

export const MEASURE_CATEGORY_LABEL: Record<MeasureCategory, string> = {
  largeur: "Largeur",
  longueur: "Longueur",
  hauteur: "Hauteur",
  distance_obstacle: "Distance à un obstacle",
  distance_rive: "Distance à la rive",
  autre: "Autre",
};

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Calcule la valeur d'une mesure. Retourne null si le nombre de points est insuffisant. */
export function computeMeasure(kind: MeasureKind, points: Vec3[]): number | null {
  const need = MEASURE_META[kind].points;
  if (points.length < need) return null;
  const [a, b, c] = points as [Vec3, Vec3, Vec3?];

  switch (kind) {
    case "distance":
    case "distance_3d":
      return norm(sub(b, a));
    case "distance_horizontal":
      return Math.hypot(b[0] - a[0], b[1] - a[1]);
    case "height":
      return Math.abs(b[2] - a[2]);
    case "elevation_delta":
      return b[2] - a[2];
    case "slope": {
      const run = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (run === 0) return 90;
      return (Math.atan2(Math.abs(b[2] - a[2]), run) * 180) / Math.PI;
    }
    case "angle": {
      if (!c) return null;
      const u = sub(a, b);
      const v = sub(c, b);
      const denom = norm(u) * norm(v);
      if (denom === 0) return null;
      const cos = Math.min(1, Math.max(-1, dot(u, v) / denom));
      return (Math.acos(cos) * 180) / Math.PI;
    }
    case "area":
      return polygonArea3(points);
    default:
      return null;
  }
}

/** Surface d'un polygone 3D quelconque (somme des produits vectoriels). */
export function polygonArea3(points: Vec3[]): number {
  if (points.length < 3) return 0;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    nx += p[1] * q[2] - p[2] * q[1];
    ny += p[2] * q[0] - p[0] * q[2];
    nz += p[0] * q[1] - p[1] * q[0];
  }
  return Math.hypot(nx, ny, nz) / 2;
}

/* --------------------------------- Snapping -------------------------------- */

export type SnapKind =
  | "endpoint"
  | "midpoint"
  | "edge"
  | "intersection"
  | "projection"
  | "parallel"
  | "perpendicular"
  | "surface"
  | "roof_plane";

export const SNAP_META: Record<SnapKind, { label: string }> = {
  endpoint: { label: "Sommet" },
  midpoint: { label: "Milieu" },
  edge: { label: "Arête" },
  intersection: { label: "Intersection" },
  projection: { label: "Projection" },
  parallel: { label: "Parallèle" },
  perpendicular: { label: "Perpendiculaire" },
  surface: { label: "Surface" },
  roof_plane: { label: "Pan de toiture" },
};

export interface SnapCandidate {
  kind: SnapKind;
  point: Vec3;
  label: string;
  /** Identifiant de l'entité accrochée (pan, arête…), utile aux cotes. */
  target_id?: string;
}

/** Priorité d'accrochage : un sommet l'emporte toujours sur une surface. */
const SNAP_PRIORITY: Record<SnapKind, number> = {
  endpoint: 0,
  intersection: 1,
  midpoint: 2,
  edge: 3,
  perpendicular: 4,
  parallel: 5,
  projection: 6,
  roof_plane: 7,
  surface: 8,
};

/** Points d'accrochage exposés par un pan : sommets, milieux d'arêtes, centre. */
export function planeSnapCandidates(plane: RoofPlaneGeometry, planeId?: string): SnapCandidate[] {
  const out: SnapCandidate[] = [];
  const pts = plane.polygon;
  const world = (p: LocalPoint): Vec3 => planePointToWorld(plane.frame, p.x, p.y);

  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length]!;
    out.push({
      kind: "endpoint",
      point: world(p),
      label: `${plane.name} — sommet ${i + 1}`,
      ...(planeId ? { target_id: planeId } : {}),
    });
    out.push({
      kind: "midpoint",
      point: world({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }),
      label: `${plane.name} — milieu d'arête ${i + 1}`,
      ...(planeId ? { target_id: planeId } : {}),
    });
  });

  const cx = pts.reduce((s, p) => s + p.x, 0) / (pts.length || 1);
  const cy = pts.reduce((s, p) => s + p.y, 0) / (pts.length || 1);
  out.push({
    kind: "roof_plane",
    point: world({ x: cx, y: cy }),
    label: `${plane.name} — centre`,
    ...(planeId ? { target_id: planeId } : {}),
  });
  return out;
}

/** Projection d'un point sur un segment, bornée aux extrémités. */
export function projectOnSegment(point: Vec3, a: Vec3, b: Vec3): Vec3 {
  const ab = sub(b, a);
  const len2 = dot(ab, ab);
  if (len2 === 0) return a;
  const t = Math.min(1, Math.max(0, dot(sub(point, a), ab) / len2));
  return [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
}

/**
 * Meilleur accrochage dans un rayon donné (mètres).
 * Déterministe : à distance égale, la priorité de type tranche.
 */
export function findSnap(point: Vec3, candidates: SnapCandidate[], radius_m = 0.6): SnapCandidate | null {
  let best: { c: SnapCandidate; d: number } | null = null;
  for (const c of candidates) {
    const d = norm(sub(c.point, point));
    if (d > radius_m) continue;
    if (
      !best ||
      d < best.d - 1e-9 ||
      (Math.abs(d - best.d) <= 1e-9 && SNAP_PRIORITY[c.kind] < SNAP_PRIORITY[best.c.kind])
    ) {
      best = { c, d };
    }
  }
  return best?.c ?? null;
}

/* ---------------------------- Cotes du projet ------------------------------ */

export type RetainedOrigin = "estimated" | "field";

export interface DimensionValues {
  value_estimated: number | null;
  value_field: number | null;
  retained_origin: RetainedOrigin;
}

/**
 * Valeur retenue d'une cote. L'ancienne valeur n'est JAMAIS écrasée :
 * estimation et mesure terrain coexistent, seule l'origine retenue change.
 */
export function retainedValue(d: DimensionValues): number | null {
  if (d.retained_origin === "field" && d.value_field != null) return d.value_field;
  if (d.retained_origin === "estimated" && d.value_estimated != null) return d.value_estimated;
  return d.value_field ?? d.value_estimated ?? null;
}

/** Écart entre estimation et mesure terrain, en mètres. null si incomparable. */
export function measurementGap(d: DimensionValues): number | null {
  if (d.value_estimated == null || d.value_field == null) return null;
  return d.value_field - d.value_estimated;
}

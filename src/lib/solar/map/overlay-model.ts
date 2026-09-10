/**
 * Solar Studio — modèle d'affichage superposé à la carte.
 *
 * Module PUR. Il projette la géométrie technique PVIA (pans, faîtages,
 * obstacles, panneaux, zones) au sol, en mètres, dans le repère local du
 * modèle. Aucune donnée n'est empruntée au fond cartographique : ce dernier
 * n'est qu'une image placée dessous.
 */
import { distance, polygonArea, type LocalPoint } from "../geo";
import { planePointToWorld } from "../roof";
import type { PlacedModule, RoofPlaneGeometry } from "../types";

export type OverlayKind = "plane" | "ridge" | "obstacle" | "module" | "forbidden";

export interface OverlayFeature {
  id: string;
  kind: OverlayKind;
  label: string;
  /** Contour au sol, en mètres, repère local (x = Est, y = Nord). */
  ring: LocalPoint[];
  closed: boolean;
  /** Origine de la donnée technique. Jamais « Google ». */
  source: string;
  detail: string[];
  planeKey: string | null;
}

export type SnapKind = "corner" | "edge" | "ridge" | "obstacle";

export const SNAP_LABEL: Record<SnapKind, string> = {
  corner: "● Coin détecté",
  edge: "— Rive",
  ridge: "— Faîtage",
  obstacle: "□ Obstacle",
};

export interface SnapTarget {
  kind: SnapKind;
  point: LocalPoint;
}

export interface OverlaySnapModel {
  corners: SnapTarget[];
  segments: { kind: SnapKind; a: LocalPoint; b: LocalPoint }[];
}

interface BuildInput {
  planes: RoofPlaneGeometry[];
  obstacles: { id: string; label: string; type: string; x: number; y: number; w: number; l: number; rotation: number; source: string }[];
  modules: PlacedModule[];
  specByPlaneKey: Record<string, { width_m: number; height_m: number; power_wc: number | null } | undefined>;
  planeSource: Record<string, string>;
}

function groundRing(plane: RoofPlaneGeometry): LocalPoint[] {
  return plane.polygon.map((p) => {
    const w = planePointToWorld(plane.frame, p.x, p.y);
    return { x: w[0], y: w[1] };
  });
}

function rect(cx: number, cy: number, w: number, h: number, rotationDeg: number): LocalPoint[] {
  const a = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ].map(([x, y]) => ({ x: cx + (x as number) * cos - (y as number) * sin, y: cy + (x as number) * sin + (y as number) * cos }));
}

/** Construit tous les objets PVIA visibles au-dessus du fond de carte. */
export function buildOverlayFeatures(input: BuildInput): OverlayFeature[] {
  const features: OverlayFeature[] = [];

  for (const plane of input.planes) {
    const ring = groundRing(plane);
    features.push({
      id: `plane:${plane.key}`,
      kind: "plane",
      label: plane.name,
      ring,
      closed: true,
      source: input.planeSource[plane.key] ?? "Géométrie paramétrique PVIA",
      detail: [
        `Surface ${plane.area_m2.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} m²`,
        `Orientation ${Math.round(plane.azimuth_deg)}°`,
        `Inclinaison ${Math.round(plane.tilt_deg)}°`,
      ],
      planeKey: plane.key,
    });

    // Faîtage : arête haute du pan, prise dans son repère puis projetée au sol.
    const maxV = Math.max(...plane.polygon.map((p) => p.y));
    const ridgePts = plane.polygon.filter((p) => Math.abs(p.y - maxV) < 1e-6);
    if (ridgePts.length >= 2) {
      const sorted = [...ridgePts].sort((a, b) => a.x - b.x);
      const first = sorted[0]!;
      const last = sorted[sorted.length - 1]!;
      const a = planePointToWorld(plane.frame, first.x, first.y);
      const b = planePointToWorld(plane.frame, last.x, last.y);
      features.push({
        id: `ridge:${plane.key}`,
        kind: "ridge",
        label: `Faîtage ${plane.name}`,
        ring: [
          { x: a[0], y: a[1] },
          { x: b[0], y: b[1] },
        ],
        closed: false,
        source: input.planeSource[plane.key] ?? "Géométrie paramétrique PVIA",
        detail: [`Longueur ${distance({ x: a[0], y: a[1] }, { x: b[0], y: b[1] }).toFixed(2)} m`],
        planeKey: plane.key,
      });
    }
  }

  for (const o of input.obstacles) {
    features.push({
      id: `obstacle:${o.id}`,
      kind: "obstacle",
      label: o.label,
      ring: rect(o.x, o.y, o.w, o.l, o.rotation),
      closed: true,
      source: o.source,
      detail: [`${o.w.toFixed(2)} × ${o.l.toFixed(2)} m`],
      planeKey: null,
    });
  }

  const planeByKey = new Map(input.planes.map((p) => [p.key, p]));
  for (const m of input.modules) {
    if (!m.enabled) continue;
    const plane = planeByKey.get(m.roof_plane_key);
    const spec = input.specByPlaneKey[m.roof_plane_key];
    if (!plane || !spec) continue;
    const w = m.orientation === "portrait" ? spec.width_m : spec.height_m;
    const h = m.orientation === "portrait" ? spec.height_m : spec.width_m;
    const corners: LocalPoint[] = [
      { x: m.local_u_m - w / 2, y: m.local_v_m - h / 2 },
      { x: m.local_u_m + w / 2, y: m.local_v_m - h / 2 },
      { x: m.local_u_m + w / 2, y: m.local_v_m + h / 2 },
      { x: m.local_u_m - w / 2, y: m.local_v_m + h / 2 },
    ].map((p) => {
      const wp = planePointToWorld(plane.frame, p.x, p.y);
      return { x: wp[0], y: wp[1] };
    });
    features.push({
      id: `module:${m.id}`,
      kind: "module",
      label: "Panneau",
      ring: corners,
      closed: true,
      source: "Implantation PVIA",
      detail: spec.power_wc ? [`${spec.power_wc} Wc`] : [],
      planeKey: plane.key,
    });
  }

  return features;
}

/** Points et arêtes sur lesquels le curseur s'accroche pendant une mesure. */
export function buildSnapModel(features: OverlayFeature[]): OverlaySnapModel {
  const corners: SnapTarget[] = [];
  const segments: OverlaySnapModel["segments"] = [];
  for (const f of features) {
    if (f.kind === "module") continue;
    const kind: SnapKind = f.kind === "ridge" ? "ridge" : f.kind === "obstacle" ? "obstacle" : "edge";
    f.ring.forEach((p) => corners.push({ kind: f.kind === "obstacle" ? "obstacle" : "corner", point: p }));
    const last = f.closed ? f.ring.length : f.ring.length - 1;
    for (let i = 0; i < last; i += 1) {
      const a = f.ring[i]!;
      const b = f.ring[(i + 1) % f.ring.length]!;
      segments.push({ kind, a, b });
    }
  }
  return { corners, segments };
}

export interface SnapResult {
  point: LocalPoint;
  kind: SnapKind | null;
  label: string | null;
}

function projectOnSegment(p: LocalPoint, a: LocalPoint, b: LocalPoint): LocalPoint {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return a;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return { x: a.x + dx * t, y: a.y + dy * t };
}

/**
 * Accroche le curseur sur la géométrie PVIA. Les coins l'emportent sur les
 * arêtes : l'utilisateur n'a jamais besoin d'être précis au pixel près.
 */
export function snapToModel(p: LocalPoint, model: OverlaySnapModel, toleranceM: number): SnapResult {
  let best: { d: number; point: LocalPoint; kind: SnapKind } | null = null;
  for (const c of model.corners) {
    const d = distance(p, c.point);
    if (d <= toleranceM && (!best || d < best.d)) best = { d, point: c.point, kind: c.kind };
  }
  if (best) return { point: best.point, kind: best.kind, label: SNAP_LABEL[best.kind] };

  for (const s of model.segments) {
    const q = projectOnSegment(p, s.a, s.b);
    const d = distance(p, q);
    if (d <= toleranceM && (!best || d < best.d)) best = { d, point: q, kind: s.kind };
  }
  if (best) return { point: best.point, kind: best.kind, label: SNAP_LABEL[best.kind] };
  return { point: p, kind: null, label: null };
}

export type MapMeasureKind = "distance" | "area";

/** Mesure calculée par le moteur PVIA, jamais par une bibliothèque du fond de carte. */
export function measureOnModel(kind: MapMeasureKind, points: LocalPoint[]): { value: number; unit: "m" | "m²"; text: string } | null {
  if (kind === "distance") {
    if (points.length < 2) return null;
    let total = 0;
    for (let i = 1; i < points.length; i += 1) total += distance(points[i - 1]!, points[i]!);
    return { value: total, unit: "m", text: `${total.toFixed(2)} m` };
  }
  if (points.length < 3) return null;
  const area = polygonArea(points);
  return { value: area, unit: "m²", text: `${area.toFixed(2)} m²` };
}

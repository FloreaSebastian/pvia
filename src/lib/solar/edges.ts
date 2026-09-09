/**
 * Solar Studio — arêtes de toiture (faîtage, arêtier, noue, égout, rive).
 *
 * Module PUR. Les arêtes sont de vraies entités géométriques : elles serviront
 * aux cotes, aux distances d'implantation, aux plans et à la visite technique.
 */
import type { RoofPlaneGeometry } from "./types";
import { planePointToWorld } from "./roof";

export type EdgeKind = "faitage" | "aretier" | "noue" | "egout" | "rive";

export const EDGE_META: Record<EdgeKind, { label: string; color: string }> = {
  faitage: { label: "Faîtage", color: "#dc2626" },
  aretier: { label: "Arêtier", color: "#ea580c" },
  noue: { label: "Noue", color: "#2563eb" },
  egout: { label: "Égout", color: "#16a34a" },
  rive: { label: "Rive", color: "#64748b" },
};

export type Vec3 = [number, number, number];

export interface RoofEdge {
  id: string;
  kind: EdgeKind;
  label: string;
  a: Vec3;
  b: Vec3;
  length_m: number;
  plane_keys: string[];
}

const EPS = 0.05; // tolérance de coïncidence entre segments, en mètres

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function sameSegment(a1: Vec3, a2: Vec3, b1: Vec3, b2: Vec3): boolean {
  return (
    (dist(a1, b1) < EPS && dist(a2, b2) < EPS) || (dist(a1, b2) < EPS && dist(a2, b1) < EPS)
  );
}

/**
 * Dérive les arêtes d'une toiture à partir de ses pans.
 * - segment partagé par deux pans, en haut  -> faîtage (horizontal) ou arêtier ;
 * - segment partagé, en creux               -> noue ;
 * - segment libre le plus bas d'un pan      -> égout ;
 * - autres segments libres                  -> rive.
 */
export function deriveRoofEdges(planes: (RoofPlaneGeometry & { id?: string })[]): RoofEdge[] {
  type Seg = { a: Vec3; b: Vec3; planeKey: string; midZ: number; minZ: number };
  const segments: Seg[] = [];

  for (const plane of planes) {
    const pts = plane.polygon;
    for (let i = 0; i < pts.length; i += 1) {
      const p = pts[i]!;
      const q = pts[(i + 1) % pts.length]!;
      const a = planePointToWorld(plane.frame, p.x, p.y);
      const b = planePointToWorld(plane.frame, q.x, q.y);
      segments.push({ a, b, planeKey: plane.key, midZ: (a[2] + b[2]) / 2, minZ: Math.min(a[2], b[2]) });
    }
  }

  const used = new Set<number>();
  const edges: RoofEdge[] = [];
  const lowestByPlane = new Map<string, { index: number; z: number }>();

  for (let i = 0; i < segments.length; i += 1) {
    const s = segments[i]!;
    const current = lowestByPlane.get(s.planeKey);
    if (!current || s.midZ < current.z - 1e-6) lowestByPlane.set(s.planeKey, { index: i, z: s.midZ });
  }

  // 1. segments partagés entre deux pans
  for (let i = 0; i < segments.length; i += 1) {
    if (used.has(i)) continue;
    const s = segments[i]!;
    for (let j = i + 1; j < segments.length; j += 1) {
      if (used.has(j)) continue;
      const t = segments[j]!;
      if (t.planeKey === s.planeKey) continue;
      if (!sameSegment(s.a, s.b, t.a, t.b)) continue;

      const horizontal = Math.abs(s.a[2] - s.b[2]) < EPS;
      const kind: EdgeKind = horizontal ? "faitage" : "aretier";
      edges.push({
        id: `edge-${i}-${j}`,
        kind,
        label: `${EDGE_META[kind].label} ${s.planeKey}/${t.planeKey}`,
        a: s.a,
        b: s.b,
        length_m: dist(s.a, s.b),
        plane_keys: [s.planeKey, t.planeKey],
      });
      used.add(i);
      used.add(j);
      break;
    }
  }

  // 2. segments libres : égout (le plus bas du pan) ou rive
  for (let i = 0; i < segments.length; i += 1) {
    if (used.has(i)) continue;
    const s = segments[i]!;
    const lowest = lowestByPlane.get(s.planeKey);
    const kind: EdgeKind = lowest?.index === i ? "egout" : "rive";
    edges.push({
      id: `edge-${i}`,
      kind,
      label: `${EDGE_META[kind].label} ${s.planeKey}`,
      a: s.a,
      b: s.b,
      length_m: dist(s.a, s.b),
      plane_keys: [s.planeKey],
    });
  }

  return edges;
}

export function edgesOfKind(edges: RoofEdge[], kind: EdgeKind): RoofEdge[] {
  return edges.filter((e) => e.kind === kind);
}

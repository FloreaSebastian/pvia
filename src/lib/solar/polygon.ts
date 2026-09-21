/**
 * Solar Studio V2 — pans de toiture dessinés librement (P0-B).
 *
 * Module PUR (aucun import serveur ni React), utilisé À LA FOIS par le canevas
 * et par le serveur : une géométrie refusée ici n'est jamais enregistrée.
 *
 * Repères :
 *  - `ring` = contour du pan projeté AU SOL, en mètres, repère local ENU
 *    (x = Est, y = Nord) — c'est ce que l'utilisateur dessine sur la carte ;
 *  - `RoofPlaneGeometry.polygon` = même contour exprimé dans le repère (u,v) du
 *    pan incliné, tel que l'attendent le moteur d'implantation et la 3D.
 */
import { azimuthToVector, distance, normalizeAzimuth, polygonArea, type LocalPoint } from "./geo";
import type { PlaneFrame, RoofPlaneGeometry } from "./types";

const DEG = Math.PI / 180;

export const MIN_VERTICES = 3;
export const MAX_VERTICES = 60;
/** Un segment plus court n'est pas dessinable de façon fiable sur une toiture. */
export const MIN_EDGE_M = 0.3;
export const MIN_AREA_M2 = 1;
export const MAX_COORD_M = 2000;
export const MAX_TILT_DEG = 70;

/* ------------------------------- Types ----------------------------------- */

export type RoofEdgeKind = "faitage" | "egout" | "rive" | "noue" | "aretier" | "indefini";

export const ROOF_EDGE_LABEL: Record<RoofEdgeKind, string> = {
  faitage: "Faîtage",
  egout: "Égout",
  rive: "Rive",
  noue: "Noue",
  aretier: "Arêtier",
  indefini: "Non classée",
};

/** Marge appliquée à une arête précise du contour (mode Expert). */
export interface RoofEdgeMargin {
  index: number;
  kind: RoofEdgeKind;
  margin_m: number;
}

/** Pan dessiné à la main, tel que persisté dans solar_buildings.custom_planes. */
export interface CustomRoofPlane {
  key: string;
  name: string;
  ring: LocalPoint[];
  tilt_deg: number;
  azimuth_deg: number;
  eave_height_m: number;
  /** Marge périphérique par défaut (m). */
  margin_m: number;
  edge_margins: RoofEdgeMargin[];
}

export type PolygonIssue =
  | "too_few_points"
  | "too_many_points"
  | "invalid_coordinate"
  | "tiny_edge"
  | "self_intersection"
  | "overlapping_edges"
  | "duplicate_vertex"
  | "tiny_area";

export const POLYGON_ISSUE_MESSAGE: Record<PolygonIssue, string> = {
  too_few_points: "Un pan a besoin d'au moins 3 angles distincts.",
  too_many_points: "Ce contour comporte trop de points : simplifiez le tracé.",
  invalid_coordinate: "Un point est hors de la zone du projet.",
  tiny_edge: "Un côté est trop court (moins de 30 cm) : supprimez ce point.",
  self_intersection: "Le contour se croise lui-même : reprenez le tracé.",
  overlapping_edges: "Deux côtés se superposent : reprenez le tracé.",
  duplicate_vertex: "Le contour se pince sur lui-même : écartez ces deux points.",
  tiny_area: "La surface obtenue est trop petite (moins de 1 m²).",
};


export interface PolygonValidation {
  valid: boolean;
  issue: PolygonIssue | null;
  message: string | null;
  area_m2: number;
  edges: number[];
}

/* ------------------------------ Validation -------------------------------- */

export function edgeLengths(ring: LocalPoint[]): number[] {
  if (ring.length < 2) return [];
  return ring.map((p, i) => distance(p, ring[(i + 1) % ring.length]!));
}

function segmentsCross(a: LocalPoint, b: LocalPoint, c: LocalPoint, d: LocalPoint): boolean {
  const o = (p: LocalPoint, q: LocalPoint, r: LocalPoint) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = o(a, b, c);
  const d2 = o(a, b, d);
  const d3 = o(c, d, a);
  const d4 = o(c, d, b);
  return d1 > 0 !== d2 > 0 && d3 > 0 !== d4 > 0;
}

/** Vrai si deux côtés non adjacents se croisent. */
export function ringSelfIntersects(ring: LocalPoint[]): boolean {
  const n = ring.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    for (let j = i + 1; j < n; j += 1) {
      // On ignore les côtés adjacents (ils partagent un sommet).
      if (j === i || (j + 1) % n === i || j === (i + 1) % n) continue;
      const c = ring[j]!;
      const d = ring[(j + 1) % n]!;
      if (segmentsCross(a, b, c, d)) return true;
    }
  }
  return false;
}

/** Tolérance de contact : en dessous, deux côtés sont considérés comme collés. */
export const CONTACT_TOL_M = 1e-3;

function segmentDistance(a: LocalPoint, b: LocalPoint, c: LocalPoint, d: LocalPoint): number {
  const pointSeg = (p: LocalPoint, s: LocalPoint, e: LocalPoint) => {
    const vx = e.x - s.x;
    const vy = e.y - s.y;
    const len2 = vx * vx + vy * vy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - s.x) * vx + (p.y - s.y) * vy) / len2));
    return distance(p, { x: s.x + vx * t, y: s.y + vy * t });
  };
  return Math.min(
    pointSeg(a, c, d),
    pointSeg(b, c, d),
    pointSeg(c, a, b),
    pointSeg(d, a, b),
  );
}

function collinearOverlap(a: LocalPoint, b: LocalPoint, c: LocalPoint, d: LocalPoint): boolean {
  const cross = (p: LocalPoint, q: LocalPoint, r: LocalPoint) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const len = distance(a, b);
  if (len === 0) return false;
  // Les 4 points doivent être alignés (écart normalisé par la longueur du côté).
  if (Math.abs(cross(a, b, c)) / len > CONTACT_TOL_M) return false;
  if (Math.abs(cross(a, b, d)) / len > CONTACT_TOL_M) return false;
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  const proj = (p: LocalPoint) => (p.x - a.x) * ux + (p.y - a.y) * uy;
  const [c1, c2] = [proj(c), proj(d)].sort((x, y) => x - y) as [number, number];
  const overlap = Math.min(len, c2) - Math.max(0, c1);
  return overlap > CONTACT_TOL_M;
}

/**
 * Contacts dégénérés entre deux côtés NON adjacents : superposition colinéaire
 * (« overlapping_edges ») ou simple pincement / sommet dupliqué
 * (« duplicate_vertex »). Un polygone concave classique n'est pas concerné.
 */
export function ringDegenerateContact(ring: LocalPoint[]): PolygonIssue | null {
  const n = ring.length;
  if (n < 4) return null;
  for (let i = 0; i < n; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    for (let j = i + 1; j < n; j += 1) {
      if (j === i || (j + 1) % n === i || j === (i + 1) % n) continue;
      const c = ring[j]!;
      const d = ring[(j + 1) % n]!;
      if (collinearOverlap(a, b, c, d)) return "overlapping_edges";
      if (segmentDistance(a, b, c, d) <= CONTACT_TOL_M) return "duplicate_vertex";
    }
  }
  return null;
}

/** Validation complète d'un contour de pan. Même règle client et serveur. */
export function validateRoofRing(ring: LocalPoint[]): PolygonValidation {
  const fail = (issue: PolygonIssue): PolygonValidation => ({
    valid: false,
    issue,
    message: POLYGON_ISSUE_MESSAGE[issue],
    area_m2: 0,
    edges: [],
  });

  if (!Array.isArray(ring) || ring.length < MIN_VERTICES) return fail("too_few_points");
  if (ring.length > MAX_VERTICES) return fail("too_many_points");
  for (const p of ring) {
    if (
      !p ||
      !Number.isFinite(p.x) ||
      !Number.isFinite(p.y) ||
      Math.abs(p.x) > MAX_COORD_M ||
      Math.abs(p.y) > MAX_COORD_M
    ) {
      return fail("invalid_coordinate");
    }
  }
  const edges = edgeLengths(ring);
  if (edges.some((l) => l < MIN_EDGE_M)) return fail("tiny_edge");
  if (ringSelfIntersects(ring)) return fail("self_intersection");
  const contact = ringDegenerateContact(ring);
  if (contact) return fail(contact);

  const area = polygonArea(ring);
  if (area < MIN_AREA_M2) return fail("tiny_area");
  return { valid: true, issue: null, message: null, area_m2: area, edges };
}

/* ------------------------------- Édition ---------------------------------- */

export function moveVertexTo(ring: LocalPoint[], index: number, point: LocalPoint): LocalPoint[] {
  return ring.map((p, i) => (i === index ? { x: point.x, y: point.y } : p));
}

export function insertVertexOnEdge(
  ring: LocalPoint[],
  edgeIndex: number,
  point: LocalPoint,
): LocalPoint[] {
  const next = [...ring];
  next.splice(edgeIndex + 1, 0, { x: point.x, y: point.y });
  return next;
}

export function removeVertexAt(ring: LocalPoint[], index: number): LocalPoint[] {
  return ring.filter((_, i) => i !== index);
}

export function translateRing(ring: LocalPoint[], dx: number, dy: number): LocalPoint[] {
  return ring.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

/** Projection d'un point sur l'arête la plus proche du contour. */
export function nearestEdge(
  ring: LocalPoint[],
  p: LocalPoint,
): { index: number; distance: number; point: LocalPoint } | null {
  if (ring.length < 2) return null;
  let best: { index: number; distance: number; point: LocalPoint } | null = null;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const len2 = vx * vx + vy * vy;
    const t =
      len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2));
    const proj = { x: a.x + vx * t, y: a.y + vy * t };
    const d = distance(p, proj);
    if (!best || d < best.distance) best = { index: i, distance: d, point: proj };
  }
  return best;
}

/* ------------------------------- Accrochage -------------------------------- */

export type DrawSnapKind = "sommet" | "arete" | "alignement";

export const DRAW_SNAP_LABEL: Record<DrawSnapKind, string> = {
  sommet: "Sommet",
  arete: "Arête",
  alignement: "Alignement",
};

export interface DrawSnapResult {
  point: LocalPoint;
  kind: DrawSnapKind | null;
  label: string | null;
}

export interface DrawSnapOptions {
  /** Contours existants (autres pans, pan en cours) servant de cibles. */
  rings: LocalPoint[][];
  /** Dernier point posé : sert à l'alignement horizontal / vertical. */
  previous?: LocalPoint | null;
  tolerance_m?: number;
  enabled?: boolean;
}

/**
 * Accrochage volontairement simple : sommet, puis arête, puis alignement sur le
 * point précédent. Aucun magnétisme caché : le point retenu est toujours nommé.
 */
export function snapDrawPoint(p: LocalPoint, options: DrawSnapOptions): DrawSnapResult {
  const tol = options.tolerance_m ?? 0.8;
  if (options.enabled === false) return { point: p, kind: null, label: null };

  let bestVertex: { d: number; point: LocalPoint } | null = null;
  let bestEdge: { d: number; point: LocalPoint } | null = null;

  for (const ring of options.rings) {
    for (const v of ring) {
      const d = distance(p, v);
      if (d <= tol && (!bestVertex || d < bestVertex.d))
        bestVertex = { d, point: { x: v.x, y: v.y } };
    }
    const edge = ring.length >= 2 ? nearestEdge(ring, p) : null;
    if (edge && edge.distance <= tol && (!bestEdge || edge.distance < bestEdge.d)) {
      bestEdge = { d: edge.distance, point: edge.point };
    }
  }

  if (bestVertex) return { point: bestVertex.point, kind: "sommet", label: DRAW_SNAP_LABEL.sommet };
  if (bestEdge) return { point: bestEdge.point, kind: "arete", label: DRAW_SNAP_LABEL.arete };

  const prev = options.previous;
  if (prev) {
    const dx = Math.abs(p.x - prev.x);
    const dy = Math.abs(p.y - prev.y);
    if (dx <= tol && dy > tol) {
      return { point: { x: prev.x, y: p.y }, kind: "alignement", label: "Aligné vertical" };
    }
    if (dy <= tol && dx > tol) {
      return { point: { x: p.x, y: prev.y }, kind: "alignement", label: "Aligné horizontal" };
    }
  }
  return { point: p, kind: null, label: null };
}

/* --------------------------- Pan → géométrie 3D ---------------------------- */

function cross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** Coordonnées (u,v) d'un point au sol dans le repère d'un pan incliné. */
export function groundToPlaneUv(
  point: LocalPoint,
  azimuthDeg: number,
  tiltDeg: number,
): LocalPoint {
  const down = azimuthToVector(azimuthDeg);
  const ridge = { x: -down.y, y: down.x };
  const t = clampTilt(tiltDeg) * DEG;
  const u = point.x * ridge.x + point.y * ridge.y;
  const downhill = point.x * down.x + point.y * down.y;
  return { x: u, y: -downhill / Math.cos(t) };
}

export function clampTilt(tiltDeg: number): number {
  if (!Number.isFinite(tiltDeg)) return 0;
  return Math.min(MAX_TILT_DEG, Math.max(0, tiltDeg));
}

/**
 * Construit la géométrie exploitable (repère du pan + frame 3D) depuis un
 * contour dessiné au sol. C'est l'unique passerelle entre le dessin 2D et
 * le moteur d'implantation / la 3D : pas de copie divergente.
 */
export function planeFromCustom(plane: CustomRoofPlane): RoofPlaneGeometry {
  const tilt = clampTilt(plane.tilt_deg);
  const az = normalizeAzimuth(plane.azimuth_deg);
  const t = tilt * DEG;
  const down = azimuthToVector(az);
  const ridge = { x: -down.y, y: down.x };
  const uv = plane.ring.map((p) => groundToPlaneUv(p, az, tilt));
  const vs = uv.map((p) => p.y);
  const vMin = vs.length ? Math.min(...vs) : 0;
  const vMax = vs.length ? Math.max(...vs) : 0;
  const eave = Number.isFinite(plane.eave_height_m) ? plane.eave_height_m : 0;
  const z0 = eave - vMin * Math.sin(t);
  const u3: [number, number, number] = [ridge.x, ridge.y, 0];
  const v3: [number, number, number] = [-down.x * Math.cos(t), -down.y * Math.cos(t), Math.sin(t)];
  const frame: PlaneFrame = {
    origin: [0, 0, z0],
    u: u3,
    v: v3,
    normal: cross(u3, v3),
  };
  return {
    key: plane.key,
    name: plane.name,
    azimuth_deg: az,
    tilt_deg: tilt,
    area_m2: polygonArea(uv),
    polygon: uv,
    frame,
    eave_height_m: eave,
    ridge_height_m: eave + (vMax - vMin) * Math.sin(t),
  };
}

/** Contour au sol d'un pan existant (paramétrique ou dessiné). */
export function planeGroundRing(plane: RoofPlaneGeometry): LocalPoint[] {
  return plane.polygon.map((p) => ({
    x: plane.frame.origin[0] + plane.frame.u[0] * p.x + plane.frame.v[0] * p.y,
    y: plane.frame.origin[1] + plane.frame.u[1] * p.x + plane.frame.v[1] * p.y,
  }));
}

/**
 * Conversion d'une toiture paramétrique en pans éditables.
 * Aucune donnée n'est perdue : les contours reprennent exactement la géométrie
 * déjà calculée, la toiture paramétrique reste enregistrée à côté.
 */
export function customPlanesFromGeometry(
  planes: RoofPlaneGeometry[],
  defaults?: { margin_m?: number },
): CustomRoofPlane[] {
  return planes.map((p) => ({
    key: p.key,
    name: p.name,
    ring: planeGroundRing(p),
    tilt_deg: clampTilt(p.tilt_deg),
    azimuth_deg: normalizeAzimuth(p.azimuth_deg),
    eave_height_m: p.eave_height_m,
    margin_m: defaults?.margin_m ?? 0.4,
    edge_margins: [],
  }));
}

/* ------------------------------- Nommage ---------------------------------- */

export function nextPlaneKey(existing: string[]): string {
  let n = 1;
  const used = new Set(existing);
  while (used.has(`pan${n}`)) n += 1;
  return `pan${n}`;
}

export function nextPlaneName(existing: string[]): string {
  let n = 1;
  const used = new Set(existing.map((s) => s.trim().toLowerCase()));
  while (used.has(`pan ${n}`)) n += 1;
  return `Pan ${n}`;
}

/* -------------------------------- Marges ---------------------------------- */

/** Marge retenue pour une arête : marge dédiée si définie, sinon marge du pan. */
export function marginForEdge(plane: CustomRoofPlane, edgeIndex: number): number {
  const specific = plane.edge_margins.find((m) => m.index === edgeIndex);
  return Math.max(0, specific ? specific.margin_m : plane.margin_m);
}

export function totalCustomArea(planes: CustomRoofPlane[]): number {
  return planes.reduce((sum, p) => sum + planeFromCustom(p).area_m2, 0);
}

/* ------------------------------- Lecture ---------------------------------- */

export interface CustomPlaneDefaults {
  tilt_deg?: number;
  eave_height_m?: number;
  margin_m?: number;
}

/**
 * Lit une liste de pans dessinés depuis une valeur JSON quelconque.
 * Toute entrée dont le contour est invalide est ignorée : ni le navigateur ni
 * la base ne peuvent introduire une géométrie non validée.
 */
export function parseCustomPlanes(raw: unknown, defaults?: CustomPlaneDefaults): CustomRoofPlane[] {
  if (!Array.isArray(raw)) return [];
  const num = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;
  const out: CustomRoofPlane[] = [];
  for (const item of raw as Partial<CustomRoofPlane>[]) {
    if (!item || typeof item.key !== "string" || !Array.isArray(item.ring)) continue;
    const ring = item.ring
      .filter((v) => v && Number.isFinite(v.x) && Number.isFinite(v.y))
      .map((v) => ({ x: Number(v.x), y: Number(v.y) }));
    if (!validateRoofRing(ring).valid) continue;
    out.push({
      key: item.key,
      name: typeof item.name === "string" && item.name.trim() ? item.name : item.key,
      ring,
      tilt_deg: clampTilt(num(item.tilt_deg, defaults?.tilt_deg ?? 30)),
      azimuth_deg: normalizeAzimuth(num(item.azimuth_deg, 180)),
      eave_height_m: num(item.eave_height_m, defaults?.eave_height_m ?? 3),
      margin_m: Math.max(0, num(item.margin_m, defaults?.margin_m ?? 0.4)),
      edge_margins: Array.isArray(item.edge_margins)
        ? item.edge_margins
            .filter((m) => m && Number.isFinite(m.index))
            .map((m) => ({
              index: Number(m.index),
              kind: (m.kind ?? "indefini") as RoofEdgeKind,
              margin_m: Math.max(0, num(m.margin_m, 0)),
            }))
        : [],
    });
  }
  return out;
}

/**
 * Smart PV Layout Engine — opérations polygonales.
 *
 * Module PUR et déterministe. Contrairement au rétrécissement naïf vers le
 * centroïde, l'offset est calculé arête par arête : il reste correct sur un
 * trapèze, un triangle ou un polygone concave, et accepte une marge
 * différente par arête (égout, faîtage, rive).
 */
import type { Pt } from "./types";

export const EPS = 1e-9;

export function signedArea(poly: Pt[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export function polygonArea(poly: Pt[]): number {
  return Math.abs(signedArea(poly));
}

/** Oriente le polygone dans le sens trigonométrique (intérieur à gauche). */
export function toCCW(poly: Pt[]): Pt[] {
  return signedArea(poly) < 0 ? [...poly].reverse() : [...poly];
}

export function bbox(poly: Pt[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i]!;
    const b = poly[j]!;
    const straddles = a.y > p.y !== b.y > p.y;
    if (!straddles) continue;
    const x = ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y || EPS) + a.x;
    if (p.x < x) inside = !inside;
  }
  return inside;
}

/** Distance d'un point au segment [a,b]. */
export function distanceToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < EPS) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Distance d'un point au bord du polygone (toujours positive). */
export function distanceToBoundary(p: Pt, poly: Pt[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i += 1) {
    const d = distanceToSegment(p, poly[i]!, poly[(i + 1) % poly.length]!);
    if (d < best) best = d;
  }
  return best;
}

function lineIntersection(p1: Pt, d1: Pt, p2: Pt, d2: Pt): Pt | null {
  const den = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / den;
  return { x: p1.x + d1.x * t, y: p1.y + d1.y * t };
}

/**
 * Offset intérieur avec une marge par arête.
 * `margins[i]` s'applique à l'arête partant du sommet i, dans l'ordre du
 * contour FOURNI. Si le contour doit être réorienté, les marges suivent leur
 * arête : une marge de faîtage ne peut pas se retrouver appliquée à l'égout.
 */
export function offsetPolygon(poly: Pt[], margins: number[]): Pt[] {
  const n = poly.length;
  if (n < 3) return [];
  const reversed = signedArea(poly) < 0;
  const p = reversed ? [...poly].reverse() : [...poly];
  // Arête j du contour inversé = arête (n-2-j) du contour d'origine.
  const m = reversed
    ? p.map((_, j) => margins[(((n - 2 - j) % n) + n) % n] ?? 0)
    : margins;
  const lines: { point: Pt; dir: Pt }[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = p[i]!;
    const b = p[(i + 1) % n]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || EPS;
    const dir = { x: dx / len, y: dy / len };
    // Normale intérieure d'un polygone CCW : rotation de +90°.
    const nx = -dir.y;
    const ny = dir.x;
    const edgeMargin = Math.max(0, m[i] ?? 0);
    lines.push({ point: { x: a.x + nx * edgeMargin, y: a.y + ny * edgeMargin }, dir });
  }
  const out: Pt[] = [];
  for (let i = 0; i < n; i += 1) {
    const prev = lines[(i - 1 + n) % n]!;
    const cur = lines[i]!;
    const hit = lineIntersection(prev.point, prev.dir, cur.point, cur.dir);
    out.push(hit ?? cur.point);
  }
  if (polygonArea(out) < EPS) return [];
  // Offset dégénéré (contour qui se retourne ou se disjoint) : aucune zone
  // utile plutôt qu'un contour approximatif laissant dépasser un module.
  if (polygonArea(out) > polygonArea(poly) + EPS) return [];
  if (signedArea(out) <= 0) return [];
  if (selfIntersects(out)) return [];
  return out;
}

/** Offset uniforme. */
export function insetPolygon(poly: Pt[], margin: number): Pt[] {
  if (margin <= 0) return toCCW(poly);
  return offsetPolygon(poly, poly.map(() => margin));
}

export interface Rect {
  u: number;
  v: number;
  width: number;
  length: number;
}

export function rectCorners(r: Rect): Pt[] {
  const hw = r.width / 2;
  const hl = r.length / 2;
  return [
    { x: r.u - hw, y: r.v - hl },
    { x: r.u + hw, y: r.v - hl },
    { x: r.u + hw, y: r.v + hl },
    { x: r.u - hw, y: r.v + hl },
  ];
}

export function rectsOverlap(a: Rect, b: Rect, pad = 0): boolean {
  return (
    Math.abs(a.u - b.u) < a.width / 2 + b.width / 2 + pad - EPS &&
    Math.abs(a.v - b.v) < a.length / 2 + b.length / 2 + pad - EPS
  );
}

function segmentsIntersect(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = o(a, b, c);
  const d2 = o(a, b, d);
  const d3 = o(c, d, a);
  const d4 = o(c, d, b);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

/** Contour qui se croise lui-même : aucune zone utile fiable n'en découle. */
export function selfIntersects(poly: Pt[]): boolean {
  const n = poly.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      // Les arêtes adjacentes partagent un sommet : ce n'est pas un croisement.
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
      if (segmentsIntersect(poly[i]!, poly[(i + 1) % n]!, poly[j]!, poly[(j + 1) % n]!)) return true;
    }
  }
  return false;
}

/** Le rectangle touche-t-il le polygone (intersection non vide) ? */
export function rectIntersectsPolygon(r: Rect, poly: Pt[]): boolean {
  if (poly.length < 3) return false;
  const corners = rectCorners(r);
  if (corners.some((c) => pointInPolygon(c, poly))) return true;
  if (poly.some((p) => pointInRect(p, r))) return true;
  for (let i = 0; i < corners.length; i += 1) {
    const a = corners[i]!;
    const b = corners[(i + 1) % corners.length]!;
    for (let j = 0; j < poly.length; j += 1) {
      if (segmentsIntersect(a, b, poly[j]!, poly[(j + 1) % poly.length]!)) return true;
    }
  }
  return false;
}

export function pointInRect(p: Pt, r: Rect): boolean {
  return Math.abs(p.x - r.u) <= r.width / 2 + EPS && Math.abs(p.y - r.v) <= r.length / 2 + EPS;
}

/** Le rectangle est-il entièrement contenu dans le polygone ? */
export function rectInsidePolygon(r: Rect, poly: Pt[]): boolean {
  if (poly.length < 3) return false;
  const corners = rectCorners(r);
  if (!corners.every((c) => pointInPolygon(c, poly))) return false;
  // Un polygone concave peut « mordre » une arête sans contenir de sommet.
  for (let i = 0; i < corners.length; i += 1) {
    const a = corners[i]!;
    const b = corners[(i + 1) % corners.length]!;
    for (let j = 0; j < poly.length; j += 1) {
      if (segmentsIntersect(a, b, poly[j]!, poly[(j + 1) % poly.length]!)) return false;
    }
  }
  return true;
}

export function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

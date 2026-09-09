/**
 * Solar Studio — détection de pans par ajustement de plan.
 *
 * Module PUR et DÉTERMINISTE : le tirage RANSAC utilise un générateur
 * pseudo-aléatoire à graine fixe, donc deux exécutions sur les mêmes points
 * donnent exactement le même résultat.
 *
 * Un pan détecté n'est JAMAIS présenté comme une toiture certaine : il porte
 * son nombre de points, son erreur d'ajustement et un niveau de confiance.
 */

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

export interface PlaneFit {
  /** Normale unitaire, orientée vers le haut (nz >= 0). */
  normal: [number, number, number];
  /** Distance signée à l'origine : n·p = d. */
  d: number;
  tilt_deg: number;
  /** Azimut géographique de la ligne de plus grande pente (0 = Nord, 180 = Sud). */
  azimuth_deg: number;
  inliers: number[];
  point_count: number;
  rmse_m: number;
  max_error_m: number;
  rejected_points: number;
  confidence: "high" | "medium" | "low";
}

/** Générateur déterministe (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function planeFromThree(a: Point3, b: Point3, c: Point3): { n: [number, number, number]; d: number } | null {
  const u = [b.x - a.x, b.y - a.y, b.z - a.z];
  const v = [c.x - a.x, c.y - a.y, c.z - a.z];
  let n: [number, number, number] = [
    u[1]! * v[2]! - u[2]! * v[1]!,
    u[2]! * v[0]! - u[0]! * v[2]!,
    u[0]! * v[1]! - u[1]! * v[0]!,
  ];
  const len = Math.hypot(n[0], n[1], n[2]);
  if (len < 1e-9) return null;
  n = [n[0] / len, n[1] / len, n[2] / len];
  if (n[2] < 0) n = [-n[0], -n[1], -n[2]];
  return { n, d: n[0] * a.x + n[1] * a.y + n[2] * a.z };
}

/** Moindres carrés (analyse en composantes principales) sur un ensemble de points. */
export function leastSquaresPlane(points: Point3[]): { n: [number, number, number]; d: number } | null {
  if (points.length < 3) return null;
  const c = points.reduce(
    (acc, p) => ({ x: acc.x + p.x / points.length, y: acc.y + p.y / points.length, z: acc.z + p.z / points.length }),
    { x: 0, y: 0, z: 0 },
  );
  let xx = 0;
  let xy = 0;
  let xz = 0;
  let yy = 0;
  let yz = 0;
  let zz = 0;
  for (const p of points) {
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    const dz = p.z - c.z;
    xx += dx * dx;
    xy += dx * dy;
    xz += dx * dz;
    yy += dy * dy;
    yz += dy * dz;
    zz += dz * dz;
  }
  const detX = yy * zz - yz * yz;
  const detY = xx * zz - xz * xz;
  const detZ = xx * yy - xy * xy;
  const detMax = Math.max(detX, detY, detZ);
  if (detMax <= 0) return null;

  let n: [number, number, number];
  if (detMax === detX) n = [detX, xz * yz - xy * zz, xy * yz - xz * yy];
  else if (detMax === detY) n = [xz * yz - xy * zz, detY, xy * xz - yz * xx];
  else n = [xy * yz - xz * yy, xy * xz - yz * xx, detZ];

  const len = Math.hypot(n[0], n[1], n[2]);
  if (len < 1e-12) return null;
  n = [n[0] / len, n[1] / len, n[2] / len];
  if (n[2] < 0) n = [-n[0], -n[1], -n[2]];
  return { n, d: n[0] * c.x + n[1] * c.y + n[2] * c.z };
}

export interface FitOptions {
  /** Tolérance d'appartenance au plan, en mètres. */
  tolerance_m?: number;
  iterations?: number;
  seed?: number;
  /** Nombre minimal de points pour accepter un pan. */
  min_points?: number;
}

/** Ajustement robuste d'un plan unique (RANSAC + raffinement moindres carrés). */
export function fitPlaneRansac(points: Point3[], options: FitOptions = {}): PlaneFit | null {
  const tol = options.tolerance_m ?? 0.15;
  const iterations = options.iterations ?? 200;
  const minPoints = options.min_points ?? 8;
  if (points.length < Math.max(3, minPoints)) return null;

  const rand = rng(options.seed ?? 12345);
  let bestInliers: number[] = [];
  let bestPlane: { n: [number, number, number]; d: number } | null = null;

  for (let it = 0; it < iterations; it += 1) {
    const i = Math.floor(rand() * points.length);
    const j = Math.floor(rand() * points.length);
    const k = Math.floor(rand() * points.length);
    if (i === j || j === k || i === k) continue;
    const plane = planeFromThree(points[i]!, points[j]!, points[k]!);
    if (!plane) continue;
    const inliers: number[] = [];
    for (let p = 0; p < points.length; p += 1) {
      const pt = points[p]!;
      const dist = Math.abs(plane.n[0] * pt.x + plane.n[1] * pt.y + plane.n[2] * pt.z - plane.d);
      if (dist <= tol) inliers.push(p);
    }
    if (inliers.length > bestInliers.length) {
      bestInliers = inliers;
      bestPlane = plane;
    }
  }

  if (!bestPlane || bestInliers.length < minPoints) return null;

  const refined = leastSquaresPlane(bestInliers.map((i) => points[i]!)) ?? bestPlane;
  const finalInliers: number[] = [];
  let sumSq = 0;
  let maxErr = 0;
  for (let p = 0; p < points.length; p += 1) {
    const pt = points[p]!;
    const dist = Math.abs(refined.n[0] * pt.x + refined.n[1] * pt.y + refined.n[2] * pt.z - refined.d);
    if (dist <= tol) {
      finalInliers.push(p);
      sumSq += dist * dist;
      maxErr = Math.max(maxErr, dist);
    }
  }
  if (finalInliers.length < minPoints) return null;

  const rmse = Math.sqrt(sumSq / finalInliers.length);
  const ratio = finalInliers.length / points.length;
  const confidence: PlaneFit["confidence"] =
    finalInliers.length >= 60 && rmse <= 0.06 && ratio >= 0.6
      ? "high"
      : finalInliers.length >= 20 && rmse <= 0.12
        ? "medium"
        : "low";

  return {
    normal: refined.n,
    d: refined.d,
    tilt_deg: (Math.acos(Math.min(1, Math.max(-1, refined.n[2]))) * 180) / Math.PI,
    azimuth_deg: normalizeDeg((Math.atan2(-refined.n[0], -refined.n[1]) * 180) / Math.PI),
    inliers: finalInliers,
    point_count: finalInliers.length,
    rmse_m: rmse,
    max_error_m: maxErr,
    rejected_points: points.length - finalInliers.length,
    confidence,
  };
}

function normalizeDeg(deg: number): number {
  const n = deg % 360;
  return n < 0 ? n + 360 : n;
}

/** Détection séquentielle de plusieurs pans : on retire les inliers à chaque passe. */
export function detectPlanes(points: Point3[], options: FitOptions & { max_planes?: number } = {}): PlaneFit[] {
  const maxPlanes = options.max_planes ?? 6;
  const out: PlaneFit[] = [];
  let remaining = points.map((p, i) => ({ p, i }));

  for (let pass = 0; pass < maxPlanes; pass += 1) {
    const fit = fitPlaneRansac(
      remaining.map((r) => r.p),
      { ...options, seed: (options.seed ?? 12345) + pass },
    );
    if (!fit) break;
    const inlierSet = new Set(fit.inliers);
    out.push({ ...fit, inliers: fit.inliers.map((idx) => remaining[idx]!.i) });
    remaining = remaining.filter((_, idx) => !inlierSet.has(idx));
    if (remaining.length < (options.min_points ?? 8)) break;
  }
  return out;
}

/* --------------------------- Contour d'un pan ------------------------------ */

export interface Point2 {
  x: number;
  y: number;
}

/** Enveloppe convexe (parcours d'Andrew). Déterministe. */
export function convexHull(points: Point2[]): Point2[] {
  if (points.length < 3) return [...points];
  const pts = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const cross = (o: Point2, a: Point2, b: Point2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const build = (src: Point2[]) => {
    const stack: Point2[] = [];
    for (const p of src) {
      while (stack.length >= 2 && cross(stack[stack.length - 2]!, stack[stack.length - 1]!, p) <= 0) stack.pop();
      stack.push(p);
    }
    stack.pop();
    return stack;
  };
  return [...build(pts), ...build([...pts].reverse())];
}

/** Simplification Douglas-Peucker : conserve trapèzes, triangles et décrochés. */
export function simplifyPolygon(points: Point2[], tolerance_m = 0.25): Point2[] {
  if (points.length <= 3) return [...points];
  const keep = new Array(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    let maxDist = 0;
    let index = -1;
    for (let i = first + 1; i < last; i += 1) {
      const dist = pointSegmentDistance(points[i]!, points[first]!, points[last]!);
      if (dist > maxDist) {
        maxDist = dist;
        index = i;
      }
    }
    if (index !== -1 && maxDist > tolerance_m) {
      keep[index] = true;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function pointSegmentDistance(p: Point2, a: Point2, b: Point2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Contour exploitable d'un pan détecté : enveloppe puis simplification. */
export function planeContour(points: Point2[], tolerance_m = 0.25): Point2[] {
  return simplifyPolygon(convexHull(points), tolerance_m);
}

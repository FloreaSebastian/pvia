/**
 * Solar Studio — exploitation d'une emprise de bâtiment.
 *
 * Module PUR. Transforme un contour (coordonnées locales, mètres) en
 * paramètres de bâtiment PROPOSÉS. Rien n'est appliqué automatiquement :
 * la proposition est comparée puis validée par l'utilisateur.
 */
import { polygonArea, normalizeAzimuth, type LocalPoint } from "./geo";
import { convexHull, simplifyPolygon, type Point2 } from "./fit";

export interface OrientedBox {
  width_m: number;
  depth_m: number;
  /** Azimut géographique de la direction « profondeur » (perpendiculaire au faîtage). */
  azimuth_deg: number;
  center: LocalPoint;
  area_m2: number;
}

/**
 * Rectangle englobant d'aire minimale (rotating calipers sur l'enveloppe convexe).
 * Déterministe : à contour identique, résultat identique.
 */
export function orientedBoundingBox(points: LocalPoint[]): OrientedBox | null {
  const hull = convexHull(points as Point2[]);
  if (hull.length < 3) return null;

  let best: (OrientedBox & { angle: number }) | null = null;

  for (let i = 0; i < hull.length; i += 1) {
    const a = hull[i]!;
    const b = hull[(i + 1) % hull.length]!;
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of hull) {
      const x = p.x * cos - p.y * sin;
      const y = p.x * sin + p.y * cos;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const w = maxX - minX;
    const h = maxY - minY;
    const area = w * h;
    if (best && area >= best.area_m2 - 1e-9) continue;

    const cxr = (minX + maxX) / 2;
    const cyr = (minY + maxY) / 2;
    const center = { x: cxr * cos + cyr * sin, y: -cxr * sin + cyr * cos };

    // Le côté le plus long porte le faîtage : la profondeur lui est perpendiculaire.
    const longIsX = w >= h;
    const ridgeAngle = longIsX ? angle : angle + Math.PI / 2;
    // angle mathématique (depuis l'Est, sens direct) -> azimut géographique
    const ridgeAzimuth = normalizeAzimuth(90 - (ridgeAngle * 180) / Math.PI);

    best = {
      width_m: Math.max(w, h),
      depth_m: Math.min(w, h),
      azimuth_deg: normalizeAzimuth(ridgeAzimuth + 90),
      center,
      area_m2: area,
      angle,
    };
  }

  if (!best) return null;
  const { angle: _angle, ...box } = best;
  return box;
}

export interface FootprintProposal {
  width_m: number;
  depth_m: number;
  azimuth_deg: number;
  /** Surface réelle du contour, distincte de celle du rectangle englobant. */
  footprint_area_m2: number;
  /** Rapport contour / rectangle : proche de 1 = bâtiment bien rectangulaire. */
  rectangularity: number;
  ring: LocalPoint[];
  wall_height_m: number | null;
}

/**
 * Proposition de bâtiment à partir d'un contour cartographique.
 * La hauteur n'est renseignée que si la source la publie : rien n'est inventé.
 */
export function proposeFromFootprint(
  ring: LocalPoint[],
  options: { source_height_m?: number | null; tilt_deg?: number; simplify_m?: number } = {},
): FootprintProposal | null {
  const simplified = simplifyPolygon(ring as Point2[], options.simplify_m ?? 0.3);
  const box = orientedBoundingBox(simplified);
  if (!box) return null;

  const area = polygonArea(simplified);
  const tilt = options.tilt_deg ?? 30;
  const sourceHeight = options.source_height_m ?? null;

  // Hauteur publiée = hauteur totale (faîtage). On en déduit la hauteur au mur.
  const wall =
    sourceHeight == null
      ? null
      : Math.max(0, sourceHeight - (box.depth_m / 2) * Math.tan((tilt * Math.PI) / 180));

  return {
    width_m: box.width_m,
    depth_m: box.depth_m,
    azimuth_deg: box.azimuth_deg,
    footprint_area_m2: area,
    rectangularity: box.area_m2 > 0 ? area / box.area_m2 : 0,
    ring: simplified,
    wall_height_m: wall,
  };
}

/**
 * Solar Studio — géoréférencement.
 *
 * Module PUR. La scène 3D travaille TOUJOURS en mètres dans un repère local
 * ENU (East / North / Up) dont l'origine est le point géocodé du projet.
 * Aucune coordonnée WGS84 n'entre dans la géométrie : on convertit seulement
 * aux frontières (import de données, export, affichage).
 */

export interface LatLon {
  latitude: number;
  longitude: number;
}

/** Point du plan local, en mètres. x = Est, y = Nord. */
export interface LocalPoint {
  x: number;
  y: number;
}

const EARTH_RADIUS_M = 6_378_137;
const DEG = Math.PI / 180;

/** Mètres par degré de latitude / longitude autour d'une origine donnée. */
export function metersPerDegree(originLatitude: number): { lat: number; lon: number } {
  const latRad = originLatitude * DEG;
  return {
    lat: (Math.PI / 180) * EARTH_RADIUS_M,
    lon: (Math.PI / 180) * EARTH_RADIUS_M * Math.cos(latRad),
  };
}

/** WGS84 -> repère local métrique (approximation plane, valable sur quelques km). */
export function toLocal(origin: LatLon, point: LatLon): LocalPoint {
  const m = metersPerDegree(origin.latitude);
  return {
    x: (point.longitude - origin.longitude) * m.lon,
    y: (point.latitude - origin.latitude) * m.lat,
  };
}

/** Repère local métrique -> WGS84. */
export function toLatLon(origin: LatLon, point: LocalPoint): LatLon {
  const m = metersPerDegree(origin.latitude);
  return {
    latitude: origin.latitude + point.y / m.lat,
    longitude: origin.longitude + point.x / m.lon,
  };
}

/** Distance plane en mètres entre deux points locaux. */
export function distance(a: LocalPoint, b: LocalPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Azimut géographique en degrés : 0 = Nord, 90 = Est, 180 = Sud, 270 = Ouest.
 * Convention conservée dans toute la base de données.
 */
export function normalizeAzimuth(deg: number): number {
  const n = deg % 360;
  return n < 0 ? n + 360 : n;
}

export function azimuthLabel(deg: number): string {
  const a = normalizeAzimuth(deg);
  const names = ["Nord", "Nord-Est", "Est", "Sud-Est", "Sud", "Sud-Ouest", "Ouest", "Nord-Ouest"];
  return names[Math.round(a / 45) % 8]!;
}

/** Vecteur unitaire horizontal (repère local) correspondant à un azimut. */
export function azimuthToVector(deg: number): LocalPoint {
  const a = normalizeAzimuth(deg) * DEG;
  return { x: Math.sin(a), y: Math.cos(a) };
}

/** Surface d'un polygone fermé (formule du lacet), en m². */
export function polygonArea(points: LocalPoint[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** Test d'appartenance d'un point à un polygone (ray casting). */
export function pointInPolygon(point: LocalPoint, polygon: LocalPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    const intersects =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || Number.EPSILON) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

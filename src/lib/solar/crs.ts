/**
 * Solar Studio — architecture de coordonnées.
 *
 * Module PUR, testé. C'est le SEUL endroit où l'on convertit entre :
 *   - un CRS géographique (EPSG:4326, degrés) ;
 *   - un CRS projeté métrique (EPSG:2154 Lambert-93, EPSG:3857 Web Mercator) ;
 *   - le repère local de la scène 3D (mètres, origine posée sur le bâtiment).
 *
 * Convention du repère local (documentée une fois pour toutes) :
 *   x = Est (+), y = Nord (+), z = altitude relative à l'altitude d'origine.
 * La scène WebGL (Three.js, y vertical) applique la permutation à la frontière
 * du rendu uniquement : voir SolarScene.tsx. Aucune coordonnée géographique de
 * grande amplitude n'entre jamais dans WebGL.
 */
import type { LatLon, LocalPoint } from "./geo";

export type GeographicCrs = "EPSG:4326";
export type ProjectedCrs = "EPSG:2154" | "EPSG:3857";
export type SupportedCrs = GeographicCrs | ProjectedCrs;
export const LOCAL_CRS = "LOCAL_ENU" as const;

export interface CrsMeta {
  code: SupportedCrs;
  label: string;
  kind: "geographic" | "projected";
  unit: "degree" | "metre";
  /** Emprise de validité approximative (lon min, lat min, lon max, lat max). */
  validity: [number, number, number, number];
}

export const CRS_REGISTRY: Record<SupportedCrs, CrsMeta> = {
  "EPSG:4326": {
    code: "EPSG:4326",
    label: "WGS 84 (degrés)",
    kind: "geographic",
    unit: "degree",
    validity: [-180, -90, 180, 90],
  },
  "EPSG:2154": {
    code: "EPSG:2154",
    label: "RGF93 / Lambert-93 (France métropolitaine)",
    kind: "projected",
    unit: "metre",
    validity: [-9.86, 41.15, 10.38, 51.56],
  },
  "EPSG:3857": {
    code: "EPSG:3857",
    label: "WGS 84 / Pseudo-Mercator",
    kind: "projected",
    unit: "metre",
    validity: [-180, -85.06, 180, 85.06],
  },
};

export interface ProjectedPoint {
  x: number;
  y: number;
  crs: ProjectedCrs;
}

/** Origine complète d'un modèle : point géodésique + altitude + CRS de travail. */
export interface LocalOrigin {
  latitude: number;
  longitude: number;
  /** Altitude de référence, en mètres NGF si connue. null = inconnue. */
  altitude_m: number | null;
  /** CRS projeté utilisé pour les calculs métriques. */
  workingCrs: ProjectedCrs;
}

export interface LocalPoint3 {
  x: number;
  y: number;
  z: number;
}

const DEG = Math.PI / 180;

/* ------------------------------ Web Mercator ------------------------------ */

const R_MERC = 6_378_137;

function toMercator(p: LatLon): { x: number; y: number } {
  const lat = Math.max(-85.06, Math.min(85.06, p.latitude));
  return {
    x: R_MERC * p.longitude * DEG,
    y: R_MERC * Math.log(Math.tan(Math.PI / 4 + (lat * DEG) / 2)),
  };
}

function fromMercator(x: number, y: number): LatLon {
  return {
    longitude: (x / R_MERC) / DEG,
    latitude: (2 * Math.atan(Math.exp(y / R_MERC)) - Math.PI / 2) / DEG,
  };
}

/* ------------------------------- Lambert-93 ------------------------------- */
/* Conique conforme sécante (2SP) sur l'ellipsoïde GRS80. Paramètres officiels. */

const GRS80_A = 6_378_137;
const GRS80_E = 0.081_819_191_042_816_9; // première excentricité
const L93 = {
  lat0: 46.5 * DEG,
  lon0: 3 * DEG,
  lat1: 44 * DEG,
  lat2: 49 * DEG,
  x0: 700_000,
  y0: 6_600_000,
};

function isoLat(lat: number): number {
  const e = GRS80_E;
  const s = Math.sin(lat);
  return Math.log(Math.tan(Math.PI / 4 + lat / 2) * Math.pow((1 - e * s) / (1 + e * s), e / 2));
}

function mFactor(lat: number): number {
  const s = Math.sin(lat);
  return Math.cos(lat) / Math.sqrt(1 - GRS80_E * GRS80_E * s * s);
}

const L93_N = (() => {
  const m1 = mFactor(L93.lat1);
  const m2 = mFactor(L93.lat2);
  return Math.log(m1 / m2) / (isoLat(L93.lat2) - isoLat(L93.lat1));
})();

const L93_C = (() => {
  const m1 = mFactor(L93.lat1);
  return (GRS80_A * m1 * Math.exp(L93_N * isoLat(L93.lat1))) / L93_N;
})();

const L93_YS = L93.y0 + L93_C * Math.exp(-L93_N * isoLat(L93.lat0));

function toLambert93(p: LatLon): { x: number; y: number } {
  const lat = p.latitude * DEG;
  const lon = p.longitude * DEG;
  const r = L93_C * Math.exp(-L93_N * isoLat(lat));
  const gamma = L93_N * (lon - L93.lon0);
  return { x: L93.x0 + r * Math.sin(gamma), y: L93_YS - r * Math.cos(gamma) };
}

function fromLambert93(x: number, y: number): LatLon {
  const dx = x - L93.x0;
  const dy = y - L93_YS;
  const r = Math.hypot(dx, dy) * (L93_N < 0 ? -1 : 1);
  const gamma = Math.atan2(dx, -dy);
  const lon = L93.lon0 + gamma / L93_N;
  const iso = -Math.log(Math.abs(r / L93_C)) / L93_N;

  // Inversion itérative de la latitude isométrique (convergence rapide).
  let lat = 2 * Math.atan(Math.exp(iso)) - Math.PI / 2;
  for (let i = 0; i < 12; i += 1) {
    const s = GRS80_E * Math.sin(lat);
    const next = 2 * Math.atan(Math.pow((1 + s) / (1 - s), GRS80_E / 2) * Math.exp(iso)) - Math.PI / 2;
    if (Math.abs(next - lat) < 1e-13) {
      lat = next;
      break;
    }
    lat = next;
  }
  return { latitude: lat / DEG, longitude: lon / DEG };
}

/* ------------------------------ API centrale ------------------------------ */

/** Le CRS projeté le mieux adapté au site. Ne suppose pas « toute la France = Lambert-93 ». */
export function pickWorkingCrs(point: LatLon): ProjectedCrs {
  const v = CRS_REGISTRY["EPSG:2154"].validity;
  const inFrance =
    point.longitude >= v[0] && point.longitude <= v[2] && point.latitude >= v[1] && point.latitude <= v[3];
  return inFrance ? "EPSG:2154" : "EPSG:3857";
}

/** Géographique -> projeté métrique. */
export function projectCoordinate(point: LatLon, crs: ProjectedCrs): ProjectedPoint {
  const p = crs === "EPSG:2154" ? toLambert93(point) : toMercator(point);
  return { x: p.x, y: p.y, crs };
}

/** Projeté métrique -> géographique. */
export function unprojectCoordinate(point: ProjectedPoint): LatLon {
  return point.crs === "EPSG:2154" ? fromLambert93(point.x, point.y) : fromMercator(point.x, point.y);
}

/**
 * Facteur d'échelle du Web Mercator à une latitude donnée : une distance
 * projetée doit être divisée par ce facteur pour redevenir une distance au sol.
 * Lambert-93 est conforme et quasi isométrique sur la France : facteur ≈ 1.
 */
export function scaleFactor(crs: ProjectedCrs, latitude: number): number {
  return crs === "EPSG:3857" ? 1 / Math.cos(latitude * DEG) : 1;
}

export function makeOrigin(point: LatLon, altitude_m: number | null = null, crs?: ProjectedCrs): LocalOrigin {
  return {
    latitude: point.latitude,
    longitude: point.longitude,
    altitude_m,
    workingCrs: crs ?? pickWorkingCrs(point),
  };
}

/**
 * Monde (géographique + altitude absolue) -> repère local métrique du modèle.
 * L'origine étant posée sur le bâtiment, les valeurs restent de l'ordre de
 * quelques dizaines de mètres : aucune perte de précision flottante.
 */
export function worldToLocal(origin: LocalOrigin, point: LatLon, altitude_m?: number | null): LocalPoint3 {
  const o = projectCoordinate(origin, origin.workingCrs);
  const p = projectCoordinate(point, origin.workingCrs);
  const k = scaleFactor(origin.workingCrs, origin.latitude);
  return {
    x: (p.x - o.x) / k,
    y: (p.y - o.y) / k,
    z: altitude_m == null || origin.altitude_m == null ? 0 : altitude_m - origin.altitude_m,
  };
}

/** Repère local -> monde. Réciproque exacte de worldToLocal. */
export function localToWorld(
  origin: LocalOrigin,
  point: LocalPoint | LocalPoint3,
): { latitude: number; longitude: number; altitude_m: number | null } {
  const o = projectCoordinate(origin, origin.workingCrs);
  const k = scaleFactor(origin.workingCrs, origin.latitude);
  const geo = unprojectCoordinate({ x: o.x + point.x * k, y: o.y + point.y * k, crs: origin.workingCrs });
  const z = "z" in point ? point.z : 0;
  return {
    latitude: geo.latitude,
    longitude: geo.longitude,
    altitude_m: origin.altitude_m == null ? null : origin.altitude_m + z,
  };
}

/** Trace de la transformation appliquée, conservée avec la donnée importée. */
export interface CrsTransformTrace {
  source_crs: string;
  working_crs: ProjectedCrs;
  local_crs: typeof LOCAL_CRS;
  origin: { latitude: number; longitude: number; altitude_m: number | null };
  applied_at: string;
}

export function describeTransform(origin: LocalOrigin, sourceCrs: string, at: Date = new Date()): CrsTransformTrace {
  return {
    source_crs: sourceCrs,
    working_crs: origin.workingCrs,
    local_crs: LOCAL_CRS,
    origin: { latitude: origin.latitude, longitude: origin.longitude, altitude_m: origin.altitude_m },
    applied_at: at.toISOString(),
  };
}

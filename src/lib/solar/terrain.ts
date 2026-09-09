/**
 * Solar Studio — terrain local et niveaux de détail.
 *
 * Module PUR. Le bâtiment ne repose plus sur un plan parfaitement horizontal :
 * un maillage d'altitude est construit autour du projet, à partir d'échantillons
 * réels (MNT) quand ils existent, sinon plat et explicitement marqué comme tel.
 */
import type { LocalPoint } from "./geo";

/** Emprises concentriques : on ne charge jamais une commune entière. */
export type DetailZone = "building" | "near" | "far";

export const DETAIL_ZONES: Record<DetailZone, { label: string; radius_m: number; grid_step_m: number }> = {
  building: { label: "Zone bâtiment", radius_m: 30, grid_step_m: 2 },
  near: { label: "Environnement immédiat", radius_m: 80, grid_step_m: 8 },
  far: { label: "Environnement lointain", radius_m: 250, grid_step_m: 25 },
};

export interface ElevationSample {
  /** Coordonnées locales, en mètres. */
  x: number;
  y: number;
  /** Altitude absolue (m NGF si connue de la source). */
  z: number;
}

export interface TerrainGrid {
  /** Altitude de référence (celle de l'origine du modèle). */
  origin_altitude_m: number;
  /** Nombre de mailles par côté. */
  size: number;
  step_m: number;
  extent_m: number;
  /** Hauteurs RELATIVES à origin_altitude_m, ligne par ligne (size × size). */
  heights: number[];
  /** false = terrain plat de repli, aucune source altimétrique utilisée. */
  from_elevation_data: boolean;
  zone: DetailZone;
}

export function flatTerrain(zone: DetailZone = "near", originAltitude = 0): TerrainGrid {
  const { radius_m, grid_step_m } = DETAIL_ZONES[zone];
  const size = Math.max(2, Math.round((radius_m * 2) / grid_step_m) + 1);
  return {
    origin_altitude_m: originAltitude,
    size,
    step_m: grid_step_m,
    extent_m: radius_m * 2,
    heights: new Array(size * size).fill(0),
    from_elevation_data: false,
    zone,
  };
}

/**
 * Interpolation par pondération inverse de la distance, bornée aux N plus
 * proches échantillons. Déterministe et stable ; ne fabrique aucune altitude
 * quand aucun échantillon n'est fourni (terrain plat explicite).
 */
export function buildTerrainGrid(
  samples: ElevationSample[],
  options: { zone?: DetailZone; originAltitude?: number; neighbours?: number } = {},
): TerrainGrid {
  const zone = options.zone ?? "near";
  const originAltitude = options.originAltitude ?? 0;
  if (!samples.length) return flatTerrain(zone, originAltitude);

  const { radius_m, grid_step_m } = DETAIL_ZONES[zone];
  const size = Math.max(2, Math.round((radius_m * 2) / grid_step_m) + 1);
  const neighbours = Math.max(1, options.neighbours ?? 6);
  const heights: number[] = new Array(size * size).fill(0);

  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      const x = -radius_m + col * grid_step_m;
      const y = -radius_m + row * grid_step_m;
      heights[row * size + col] = idwSample(samples, x, y, neighbours) - originAltitude;
    }
  }

  return {
    origin_altitude_m: originAltitude,
    size,
    step_m: grid_step_m,
    extent_m: radius_m * 2,
    heights,
    from_elevation_data: true,
    zone,
  };
}

function idwSample(samples: ElevationSample[], x: number, y: number, neighbours: number): number {
  const ranked = samples
    .map((s) => ({ s, d2: (s.x - x) ** 2 + (s.y - y) ** 2 }))
    .sort((a, b) => a.d2 - b.d2)
    .slice(0, neighbours);
  const exact = ranked.find((r) => r.d2 < 1e-9);
  if (exact) return exact.s.z;
  let num = 0;
  let den = 0;
  for (const r of ranked) {
    const w = 1 / r.d2;
    num += w * r.s.z;
    den += w;
  }
  return den === 0 ? 0 : num / den;
}

/** Hauteur relative du terrain en un point local (interpolation bilinéaire). */
export function terrainHeightAt(grid: TerrainGrid, point: LocalPoint): number {
  const half = grid.extent_m / 2;
  const fx = (point.x + half) / grid.step_m;
  const fy = (point.y + half) / grid.step_m;
  const clamp = (v: number) => Math.max(0, Math.min(grid.size - 1, v));
  const x0 = Math.floor(clamp(fx));
  const y0 = Math.floor(clamp(fy));
  const x1 = Math.min(grid.size - 1, x0 + 1);
  const y1 = Math.min(grid.size - 1, y0 + 1);
  const tx = clamp(fx) - x0;
  const ty = clamp(fy) - y0;
  const h = (col: number, row: number) => grid.heights[row * grid.size + col] ?? 0;
  const top = h(x0, y0) * (1 - tx) + h(x1, y0) * tx;
  const bottom = h(x0, y1) * (1 - tx) + h(x1, y1) * tx;
  return top * (1 - ty) + bottom * ty;
}

/** Altitude d'assise du bâtiment : moyenne du terrain sous son emprise. */
export function seatHeight(grid: TerrainGrid, footprint: LocalPoint[]): number {
  if (!footprint.length) return terrainHeightAt(grid, { x: 0, y: 0 });
  const sum = footprint.reduce((acc, p) => acc + terrainHeightAt(grid, p), 0);
  return sum / footprint.length;
}

/** Pente moyenne du terrain sous l'emprise, en degrés. */
export function terrainSlopeDeg(grid: TerrainGrid, footprint: LocalPoint[]): number {
  if (footprint.length < 2) return 0;
  const hs = footprint.map((p) => terrainHeightAt(grid, p));
  const drop = Math.max(...hs) - Math.min(...hs);
  const xs = footprint.map((p) => p.x);
  const ys = footprint.map((p) => p.y);
  const run = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  if (run === 0) return 0;
  return (Math.atan2(drop, run) * 180) / Math.PI;
}

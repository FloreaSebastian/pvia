/**
 * Solar Studio — toitures paramétriques.
 *
 * Module PUR et déterministe : à paramètres identiques, géométrie identique.
 * Toutes les longueurs sont en mètres, les angles en degrés, les azimuts
 * géographiques (0 = Nord, 180 = Sud).
 */
import { azimuthToVector, normalizeAzimuth, polygonArea, type LocalPoint } from "./geo";
import type { BuildingParams, PlaneFrame, RoofPlaneGeometry } from "./types";

const DEG = Math.PI / 180;

type Vec3 = [number, number, number];

function scale(v: Vec3, k: number): Vec3 {
  return [v[0] * k, v[1] * k, v[2] * k];
}

function add(...vs: Vec3[]): Vec3 {
  return vs.reduce<Vec3>((acc, v) => [acc[0] + v[0], acc[1] + v[1], acc[2] + v[2]], [0, 0, 0]);
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** Axes horizontaux du bâtiment : `down` = direction de descente du pan principal. */
export function buildingAxes(azimuthDeg: number): { down: Vec3; ridge: Vec3 } {
  const h = azimuthToVector(azimuthDeg);
  // repère 3D : x = Est, y = Nord, z = hauteur
  const down: Vec3 = [h.x, h.y, 0];
  // (u, v, normale) forme un trièdre direct, normale vers le haut
  const ridge: Vec3 = [-h.y, h.x, 0];
  return { down, ridge };
}

function rectangle(width: number, length: number): LocalPoint[] {
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: length },
    { x: 0, y: length },
  ];
}

function makeFrame(origin: Vec3, u: Vec3, downhill: Vec3, tiltDeg: number): PlaneFrame {
  const t = tiltDeg * DEG;
  // v monte la pente : opposé de la descente, plus la composante verticale
  const v: Vec3 = [-downhill[0] * Math.cos(t), -downhill[1] * Math.cos(t), Math.sin(t)];
  const normal = cross(u, v);
  return { origin, u, v, normal };
}

/** Contour du bâtiment (emprise au sol, sans débord) dans le repère local. */
export function footprintPolygon(params: BuildingParams): LocalPoint[] {
  const { down, ridge } = buildingAxes(params.azimuth_deg);
  const hw = params.width_m / 2;
  const hd = params.depth_m / 2;
  const corners: [number, number][] = [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ];
  return corners.map(([a, b]) => ({
    x: ridge[0] * a + down[0] * b,
    y: ridge[1] * a + down[1] * b,
  }));
}

/**
 * Décompose une toiture paramétrique en pans exploitables.
 * Chaque pan porte son repère (u le long de l'égout, v montant la pente).
 */
export function buildRoofPlanes(params: BuildingParams): RoofPlaneGeometry[] {
  const ov = Math.max(0, params.overhang_m);
  const W = Math.max(1, params.width_m) + 2 * ov;
  const D = Math.max(1, params.depth_m) + 2 * ov;
  const wall = Math.max(0, params.wall_height_m);
  const tilt = params.roof_type === "terrasse" ? 0 : Math.min(70, Math.max(0, params.tilt_deg));
  const t = tilt * DEG;
  const { down, ridge } = buildingAxes(params.azimuth_deg);
  const az = normalizeAzimuth(params.azimuth_deg);
  const planes: RoofPlaneGeometry[] = [];

  /** Origine : coin bas-gauche du pan, vu depuis l'extérieur. */
  const cornerAt = (alongRidge: number, alongDown: number, z: number): Vec3 =>
    add(scale(ridge, alongRidge), scale(down, alongDown), [0, 0, z]);

  const slope = (run: number) => run / Math.cos(t);

  const pushRect = (
    key: string,
    name: string,
    azimuth: number,
    origin: Vec3,
    u: Vec3,
    downhill: Vec3,
    width: number,
    run: number,
    eave: number,
  ) => {
    const L = slope(run);
    const polygon = rectangle(width, L);
    planes.push({
      key,
      name,
      azimuth_deg: normalizeAzimuth(azimuth),
      tilt_deg: tilt,
      area_m2: polygonArea(polygon),
      polygon,
      frame: makeFrame(origin, u, downhill, tilt),
      eave_height_m: eave,
      ridge_height_m: eave + run * Math.tan(t),
    });
  };

  if (params.roof_type === "terrasse") {
    pushRect("p1", "Toiture terrasse", az, cornerAt(-W / 2, D / 2, wall), ridge, down, W, D, wall);
    return planes;
  }

  if (params.roof_type === "monopente") {
    pushRect("p1", "Pan unique", az, cornerAt(-W / 2, D / 2, wall), ridge, down, W, D, wall);
    return planes;
  }

  if (params.roof_type === "deux_pans") {
    pushRect("p1", "Pan avant", az, cornerAt(-W / 2, D / 2, wall), ridge, down, W, D / 2, wall);
    pushRect(
      "p2",
      "Pan arrière",
      az + 180,
      cornerAt(W / 2, -D / 2, wall),
      scale(ridge, -1),
      scale(down, -1),
      W,
      D / 2,
      wall,
    );
    return planes;
  }

  // quatre_pans (croupe) : deux trapèzes + deux triangles, même pente
  const ridgeLength = Math.max(0, W - D);
  const run = D / 2;
  const L = slope(run);
  const topInset = (W - ridgeLength) / 2;

  const trapezoid = (key: string, name: string, azimuth: number, origin: Vec3, u: Vec3, downhill: Vec3) => {
    const polygon: LocalPoint[] = [
      { x: 0, y: 0 },
      { x: W, y: 0 },
      { x: W - topInset, y: L },
      { x: topInset, y: L },
    ];
    planes.push({
      key,
      name,
      azimuth_deg: normalizeAzimuth(azimuth),
      tilt_deg: tilt,
      area_m2: polygonArea(polygon),
      polygon,
      frame: makeFrame(origin, u, downhill, tilt),
      eave_height_m: wall,
      ridge_height_m: wall + run * Math.tan(t),
    });
  };

  const triangle = (key: string, name: string, azimuth: number, origin: Vec3, u: Vec3, downhill: Vec3) => {
    const hipRun = W / 2 - ridgeLength / 2;
    const hipL = slope(hipRun);
    const polygon: LocalPoint[] = [
      { x: 0, y: 0 },
      { x: D, y: 0 },
      { x: D / 2, y: hipL },
    ];
    planes.push({
      key,
      name,
      azimuth_deg: normalizeAzimuth(azimuth),
      tilt_deg: tilt,
      area_m2: polygonArea(polygon),
      polygon,
      frame: makeFrame(origin, u, downhill, tilt),
      eave_height_m: wall,
      ridge_height_m: wall + hipRun * Math.tan(t),
    });
  };

  trapezoid("p1", "Pan avant", az, cornerAt(-W / 2, D / 2, wall), ridge, down);
  trapezoid("p2", "Pan arrière", az + 180, cornerAt(W / 2, -D / 2, wall), scale(ridge, -1), scale(down, -1));
  triangle("p3", "Croupe gauche", az - 90, cornerAt(-W / 2, -D / 2, wall), down, scale(ridge, -1));
  triangle("p4", "Croupe droite", az + 90, cornerAt(W / 2, D / 2, wall), scale(down, -1), ridge);

  return planes;
}

/** Point 3D correspondant à une coordonnée (u,v) d'un pan. */
export function planePointToWorld(frame: PlaneFrame, u: number, v: number): Vec3 {
  return [
    frame.origin[0] + frame.u[0] * u + frame.v[0] * v,
    frame.origin[1] + frame.u[1] * u + frame.v[1] * v,
    frame.origin[2] + frame.u[2] * u + frame.v[2] * v,
  ];
}

export function totalRoofArea(planes: RoofPlaneGeometry[]): number {
  return planes.reduce((sum, p) => sum + p.area_m2, 0);
}

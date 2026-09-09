/**
 * Solar Studio — phase 2 : tests numériques des modules purs.
 * Aucune dépendance réseau : les fournisseurs ne sont pas testés ici.
 */
import { describe, expect, it } from "vitest";
import { makeOrigin, projectCoordinate, unprojectCoordinate, worldToLocal, localToWorld, pickWorkingCrs } from "@/lib/solar/crs";
import { formatLength, slopePercent, toMeters, fromMeters } from "@/lib/solar/units";
import { fingerprint, stableStringify, geometryFingerprint } from "@/lib/solar/hash";
import { buildTerrainGrid, flatTerrain, terrainHeightAt, DETAIL_ZONES } from "@/lib/solar/terrain";
import { fitPlaneRansac, convexHull, simplifyPolygon } from "@/lib/solar/fit";
import { computeMeasure, polygonArea3, findSnap, retainedValue, measurementGap } from "@/lib/solar/measure";
import { orientedBoundingBox, proposeFromFootprint } from "@/lib/solar/footprint";
import { compareGeometry } from "@/lib/solar/diff";
import { buildRoofPlanes } from "@/lib/solar/roof";
import { DEFAULT_BUILDING_PARAMS } from "@/lib/solar/types";

describe("CRS et repère local", () => {
  const paris = { latitude: 48.8566, longitude: 2.3522 };

  it("projette et déprojette sans dérive significative", () => {
    const projected = projectCoordinate(paris, pickWorkingCrs(paris));
    const back = unprojectCoordinate(projected);
    expect(back.latitude).toBeCloseTo(paris.latitude, 6);
    expect(back.longitude).toBeCloseTo(paris.longitude, 6);
  });

  it("fait un aller-retour local exact au centimètre", () => {
    const origin = makeOrigin(paris, 35);
    const point = { latitude: paris.latitude + 0.0005, longitude: paris.longitude + 0.0007 };
    const local = worldToLocal(origin, point, 42);
    const world = localToWorld(origin, local);
    expect(world.latitude).toBeCloseTo(point.latitude, 7);
    expect(world.longitude).toBeCloseTo(point.longitude, 7);
    expect(local.z).toBeCloseTo(7, 6);
  });

  it("garde des coordonnées locales petites (pas de grands nombres dans la scène)", () => {
    const origin = makeOrigin(paris, null);
    const local = worldToLocal(origin, { latitude: paris.latitude + 0.001, longitude: paris.longitude });
    expect(Math.abs(local.x)).toBeLessThan(500);
    expect(Math.abs(local.y)).toBeLessThan(500);
  });
});

describe("Unités", () => {
  it("convertit sans perte utile", () => {
    expect(toMeters(1500, "mm")).toBeCloseTo(1.5, 9);
    expect(fromMeters(1.5, "cm")).toBeCloseTo(150, 9);
    expect(formatLength(12.345)).toContain("m");
  });

  it("convertit une pente en pourcentage", () => {
    expect(slopePercent(45)).toBeCloseTo(100, 6);
  });
});

describe("Empreinte géométrique", () => {
  it("est stable quel que soit l'ordre des clés", () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
    expect(fingerprint({ a: 1, b: 2 })).toBe(fingerprint({ b: 2, a: 1 }));
  });

  it("change quand la géométrie change", () => {
    const planes = buildRoofPlanes(DEFAULT_BUILDING_PARAMS);
    const a = geometryFingerprint({ params: DEFAULT_BUILDING_PARAMS, planes });
    const modified = { ...DEFAULT_BUILDING_PARAMS, width_m: 12 };
    const b = geometryFingerprint({ params: modified, planes: buildRoofPlanes(modified) });
    expect(a).not.toBe(b);
  });
});

describe("Terrain", () => {
  it("marque explicitement un terrain plat de repli", () => {
    const flat = flatTerrain("near", 100);
    expect(flat.from_elevation_data).toBe(false);
    expect(terrainHeightAt(flat, { x: 3, y: -4 })).toBeCloseTo(0, 9);
  });

  it("interpole un plan incliné connu", () => {
    const samples = [];
    for (let x = -40; x <= 40; x += 10) {
      for (let y = -40; y <= 40; y += 10) samples.push({ x, y, z: 100 + 0.05 * x });
    }
    const grid = buildTerrainGrid(samples, { zone: "near", originAltitude: 100 });
    expect(grid.from_elevation_data).toBe(true);
    expect(grid.step_m).toBe(DETAIL_ZONES.near.grid_step_m);
    expect(terrainHeightAt(grid, { x: 20, y: 0 })).toBeCloseTo(1, 1);
    expect(terrainHeightAt(grid, { x: -20, y: 0 })).toBeCloseTo(-1, 1);
  });
});

describe("Ajustement de plan", () => {
  it("retrouve un plan incliné bruité", () => {
    const pts = [];
    for (let x = 0; x < 6; x += 1) {
      for (let y = 0; y < 6; y += 1) {
        pts.push({ x, y, z: 2 + 0.5 * x + (x + y) % 2 ? 0 : 0 });
      }
    }
    const clean = pts.map((p) => ({ x: p.x, y: p.y, z: 2 + 0.5 * p.x }));
    const fit = fitPlaneRansac(clean, { iterations: 60 });
    expect(fit).not.toBeNull();
    expect(fit!.rmse).toBeLessThan(0.05);
    expect(fit!.tilt_deg).toBeCloseTo((Math.atan(0.5) * 180) / Math.PI, 1);
  });

  it("est déterministe", () => {
    const pts = Array.from({ length: 30 }, (_, i) => ({ x: i % 6, y: Math.floor(i / 6), z: 1 + 0.2 * (i % 6) }));
    const a = fitPlaneRansac(pts, { iterations: 40 });
    const b = fitPlaneRansac(pts, { iterations: 40 });
    expect(a?.rmse).toBe(b?.rmse);
  });

  it("simplifie un contour sans le déformer", () => {
    const square = [
      { x: 0, y: 0 },
      { x: 5, y: 0.02 },
      { x: 10, y: 0 },
      { x: 10, y: 8 },
      { x: 0, y: 8 },
    ];
    const hull = convexHull(square);
    expect(hull.length).toBeGreaterThanOrEqual(4);
    expect(simplifyPolygon(square, 0.3).length).toBeLessThanOrEqual(square.length);
  });
});

describe("Mesures", () => {
  it("calcule distances, hauteurs et surfaces", () => {
    expect(computeMeasure("distance_3d", [{ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 12 }])).toBeCloseTo(13, 9);
    expect(computeMeasure("distance_horizontal", [{ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 12 }])).toBeCloseTo(5, 9);
    expect(computeMeasure("height", [{ x: 0, y: 0, z: 1 }, { x: 3, y: 4, z: 5 }])).toBeCloseTo(4, 9);
    expect(
      polygonArea3([
        { x: 0, y: 0, z: 0 },
        { x: 4, y: 0, z: 0 },
        { x: 4, y: 3, z: 0 },
        { x: 0, y: 3, z: 0 },
      ]),
    ).toBeCloseTo(12, 9);
  });

  it("accroche au point le plus proche dans le rayon, sinon rien", () => {
    const candidates = [
      { kind: "vertex" as const, label: "A", point: { x: 0, y: 0, z: 0 } },
      { kind: "vertex" as const, label: "B", point: { x: 5, y: 0, z: 0 } },
    ];
    expect(findSnap({ x: 0.2, y: 0, z: 0 }, candidates, 0.6)?.label).toBe("A");
    expect(findSnap({ x: 2.5, y: 0, z: 0 }, candidates, 0.6)).toBeNull();
  });

  it("retient la mesure terrain et expose l'écart", () => {
    const d = { estimated: 10, field: 10.4, retained_origin: "field" as const };
    expect(retainedValue(d)).toBeCloseTo(10.4, 9);
    expect(measurementGap(d)).toBeCloseTo(0.4, 9);
  });
});

describe("Emprise cartographique", () => {
  const ring = [
    { x: 0, y: 0 },
    { x: 12, y: 0 },
    { x: 12, y: 8 },
    { x: 0, y: 8 },
  ];

  it("retrouve les dimensions d'un rectangle", () => {
    const box = orientedBoundingBox(ring);
    expect(box).not.toBeNull();
    expect(box!.width_m).toBeCloseTo(12, 6);
    expect(box!.depth_m).toBeCloseTo(8, 6);
  });

  it("ne propose pas de hauteur quand la source n'en publie pas", () => {
    const proposal = proposeFromFootprint(ring, { source_height_m: null });
    expect(proposal?.wall_height_m).toBeNull();
    expect(proposal?.rectangularity).toBeCloseTo(1, 2);
  });

  it("déduit une hauteur au mur quand la source publie une hauteur totale", () => {
    const proposal = proposeFromFootprint(ring, { source_height_m: 9, tilt_deg: 30 });
    expect(proposal!.wall_height_m!).toBeLessThan(9);
    expect(proposal!.wall_height_m!).toBeGreaterThan(0);
  });
});

describe("Comparaison de géométries", () => {
  it("liste les écarts sans rien appliquer", () => {
    const params = DEFAULT_BUILDING_PARAMS;
    const proposed = { ...params, width_m: 12, tilt_deg: 35 };
    const changes = compareGeometry(
      { params, planes: buildRoofPlanes(params) },
      { params: proposed, planes: buildRoofPlanes(proposed) },
    );
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.some((c) => c.label.toLowerCase().includes("largeur"))).toBe(true);
  });
});

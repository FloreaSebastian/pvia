import { describe, expect, test } from "bun:test";
import {
  buildOverlayFeatures,
  buildSnapModel,
  measureOnModel,
  snapToModel,
  type OverlayPlane,
} from "../../src/lib/solar/map/overlay-model";
import { GOOGLE_MAPS_PROVIDER, MAP_LAYER_LABEL } from "../../src/lib/solar/map/provider";

/** Pan horizontal simple : le repère plan coïncide avec le sol. */
const plane: OverlayPlane = {
  key: "sud",
  name: "Pan Sud",
  polygon: [
    { x: 0, y: 0 },
    { x: 6, y: 0 },
    { x: 6, y: 4 },
    { x: 0, y: 4 },
  ],
  frame: {
    origin: [0, 0, 3],
    u: [1, 0, 0],
    v: [0, 1, 0],
    normal: [0, 0, 1],
  },
  azimuth_deg: 180,
  tilt_deg: 30,
  area_m2: 24,
};

function features() {
  return buildOverlayFeatures({
    planes: [plane],
    obstacles: [
      { id: "o1", label: "Cheminée", type: "cheminee", x: 3, y: 2, w: 1, l: 1, rotation: 0, source: "Relevé PVIA" },
    ],
    modules: [
      { id: "m1", roof_plane_key: "sud", u: 1, v: 1, rotation_deg: 0, enabled: true } as never,
    ],
    specByPlaneKey: { sud: { width_m: 1.1, height_m: 1.7, power_wc: 425 } },
    planeSource: { sud: "LiDAR / IGN" },
  });
}

describe("superposition PVIA sur fond cartographique", () => {
  test("projette le pan au sol dans le repère métrique local", () => {
    const f = features().find((x) => x.kind === "plane");
    expect(f).toBeTruthy();
    expect(f!.ring).toHaveLength(4);
    expect(f!.ring[2]).toEqual({ x: 6, y: 4 });
    expect(f!.source).toBe("LiDAR / IGN");
  });

  test("n'attribue jamais la géométrie au fond de carte", () => {
    for (const f of features()) expect(f.source.toLowerCase()).not.toContain("google");
    expect(GOOGLE_MAPS_PROVIDER.derivativeRestriction).toContain("Aucun contour");
  });

  test("produit faîtage, obstacle et panneau", () => {
    const kinds = features().map((f) => f.kind);
    expect(kinds).toContain("ridge");
    expect(kinds).toContain("obstacle");
    expect(kinds).toContain("module");
  });

  test("le libellé de couche reste explicite", () => {
    expect(MAP_LAYER_LABEL.photorealistic_3d.length).toBeGreaterThan(0);
    expect(MAP_LAYER_LABEL.satellite).toBe("Satellite");
  });
});

describe("accrochage et mesure", () => {
  const snap = buildSnapModel(features());

  test("accroche un coin détecté", () => {
    const r = snapToModel({ x: 6.2, y: 3.9 }, snap, 1);
    expect(r.point).toEqual({ x: 6, y: 4 });
    expect(r.label).toBe("Coin détecté");
  });

  test("accroche une rive quand aucun coin n'est proche", () => {
    const r = snapToModel({ x: 3, y: -0.2 }, snap, 1);
    expect(r.point.y).toBeCloseTo(0, 6);
    expect(r.kind).not.toBe("corner");
  });

  test("laisse le point libre hors tolérance", () => {
    const r = snapToModel({ x: 40, y: 40 }, snap, 1);
    expect(r.kind).toBeNull();
    expect(r.point).toEqual({ x: 40, y: 40 });
  });

  test("mesure une distance en mètres", () => {
    const r = measureOnModel("distance", [
      { x: 0, y: 0 },
      { x: 3, y: 4 },
    ]);
    expect(r?.value).toBeCloseTo(5, 6);
    expect(r?.unit).toBe("m");
  });

  test("mesure une surface fermée", () => {
    const r = measureOnModel("area", [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 6, y: 4 },
      { x: 0, y: 4 },
    ]);
    expect(r?.value).toBeCloseTo(24, 6);
    expect(r?.unit).toBe("m²");
  });

  test("refuse une mesure incomplète", () => {
    expect(measureOnModel("distance", [{ x: 0, y: 0 }])).toBeNull();
    expect(measureOnModel("area", [{ x: 0, y: 0 }, { x: 1, y: 0 }])).toBeNull();
  });
});

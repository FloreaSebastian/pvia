import { describe, expect, it } from "vitest";
import { azimuthLabel, normalizeAzimuth, polygonArea, pointInPolygon, toLatLon, toLocal } from "@/lib/solar/geo";
import { buildRoofPlanes, footprintPolygon, totalRoofArea } from "@/lib/solar/roof";
import { gridLayout, insetPolygon, moduleFootprint, powerKwc } from "@/lib/solar/layout";
import { computeSolarSummary } from "@/lib/solar/summary";
import { DEFAULT_BUILDING_PARAMS, type BuildingParams } from "@/lib/solar/types";

const SPEC = { power_wc: 450, width_mm: 1134, height_mm: 1762 };

describe("géoréférencement local", () => {
  const origin = { latitude: 45.75, longitude: 4.85 };

  it("fait l'aller-retour WGS84 <-> mètres", () => {
    const point = { latitude: 45.7512, longitude: 4.8523 };
    const local = toLocal(origin, point);
    const back = toLatLon(origin, local);
    expect(back.latitude).toBeCloseTo(point.latitude, 9);
    expect(back.longitude).toBeCloseTo(point.longitude, 9);
  });

  it("place l'origine en (0,0)", () => {
    expect(toLocal(origin, origin)).toEqual({ x: 0, y: 0 });
  });

  it("normalise et nomme les azimuts", () => {
    expect(normalizeAzimuth(-90)).toBe(270);
    expect(azimuthLabel(180)).toBe("Sud");
    expect(azimuthLabel(0)).toBe("Nord");
    expect(azimuthLabel(270)).toBe("Ouest");
  });

  it("calcule surfaces et appartenance", () => {
    const square = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 3 },
      { x: 0, y: 3 },
    ];
    expect(polygonArea(square)).toBe(12);
    expect(pointInPolygon({ x: 2, y: 1 }, square)).toBe(true);
    expect(pointInPolygon({ x: 5, y: 1 }, square)).toBe(false);
  });
});

describe("toitures paramétriques", () => {
  const base: BuildingParams = { ...DEFAULT_BUILDING_PARAMS, width_m: 10, depth_m: 8, overhang_m: 0 };

  it("terrasse : un pan plat de la surface de l'emprise", () => {
    const planes = buildRoofPlanes({ ...base, roof_type: "terrasse" });
    expect(planes).toHaveLength(1);
    expect(planes[0]!.tilt_deg).toBe(0);
    expect(planes[0]!.area_m2).toBeCloseTo(80, 6);
  });

  it("monopente : surface = emprise / cos(pente)", () => {
    const planes = buildRoofPlanes({ ...base, roof_type: "monopente", tilt_deg: 30 });
    expect(planes).toHaveLength(1);
    expect(planes[0]!.area_m2).toBeCloseTo(80 / Math.cos(Math.PI / 6), 4);
  });

  it("deux pans : deux moitiés opposées de même surface", () => {
    const planes = buildRoofPlanes({ ...base, roof_type: "deux_pans", tilt_deg: 30, azimuth_deg: 180 });
    expect(planes).toHaveLength(2);
    expect(planes[0]!.azimuth_deg).toBe(180);
    expect(planes[1]!.azimuth_deg).toBe(0);
    expect(planes[0]!.area_m2).toBeCloseTo(planes[1]!.area_m2, 9);
    expect(totalRoofArea(planes)).toBeCloseTo(80 / Math.cos(Math.PI / 6), 4);
  });

  it("quatre pans : deux trapèzes et deux croupes", () => {
    const planes = buildRoofPlanes({ ...base, roof_type: "quatre_pans", tilt_deg: 35 });
    expect(planes).toHaveLength(4);
    expect(planes.filter((p) => p.polygon.length === 4)).toHaveLength(2);
    expect(planes.filter((p) => p.polygon.length === 3)).toHaveLength(2);
  });

  it("est déterministe", () => {
    expect(buildRoofPlanes(base)).toEqual(buildRoofPlanes(base));
  });

  it("le faîtage est plus haut que l'égout", () => {
    const [plane] = buildRoofPlanes({ ...base, roof_type: "deux_pans", tilt_deg: 40, wall_height_m: 3 });
    expect(plane!.ridge_height_m).toBeGreaterThan(plane!.eave_height_m);
  });

  it("l'emprise au sol a la surface attendue", () => {
    expect(polygonArea(footprintPolygon(base))).toBeCloseTo(80, 6);
  });
});

describe("implantation", () => {
  const plane = buildRoofPlanes({
    ...DEFAULT_BUILDING_PARAMS,
    roof_type: "monopente",
    width_m: 10,
    depth_m: 8,
    overhang_m: 0,
    tilt_deg: 20,
  })[0]!;

  it("oriente le module selon le mode de pose", () => {
    expect(moduleFootprint(SPEC, "portrait")).toEqual({ width: 1.134, length: 1.762 });
    expect(moduleFootprint(SPEC, "paysage")).toEqual({ width: 1.762, length: 1.134 });
  });

  it("pose des modules et respecte les reculs", () => {
    const modules = gridLayout(plane, SPEC, [], {
      setback_m: 0.4,
      row_gap_m: 0.02,
      col_gap_m: 0.02,
      orientation: "portrait",
      forbidden: [],
    });
    expect(modules.length).toBeGreaterThan(10);
    for (const m of modules) {
      expect(m.local_u_m).toBeGreaterThan(0.4);
      expect(m.local_v_m).toBeGreaterThan(0.4);
    }
  });

  it("un recul plus grand réduit le nombre de modules", () => {
    const few = gridLayout(plane, SPEC, [], {
      setback_m: 1.5,
      row_gap_m: 0.02,
      col_gap_m: 0.02,
      orientation: "portrait",
      forbidden: [],
    });
    const many = gridLayout(plane, SPEC, [], {
      setback_m: 0.2,
      row_gap_m: 0.02,
      col_gap_m: 0.02,
      orientation: "portrait",
      forbidden: [],
    });
    expect(few.length).toBeLessThan(many.length);
  });

  it("évite les obstacles et leur marge", () => {
    const without = gridLayout(plane, SPEC, [], {
      setback_m: 0.4,
      row_gap_m: 0.02,
      col_gap_m: 0.02,
      orientation: "portrait",
      forbidden: [],
    });
    const withObstacle = gridLayout(
      plane,
      SPEC,
      [{ id: "o1", u: 5, v: 4, width_m: 1.2, length_m: 1.2, clearance_m: 0.5 }],
      { setback_m: 0.4, row_gap_m: 0.02, col_gap_m: 0.02, orientation: "portrait", forbidden: [] },
    );
    expect(withObstacle.length).toBeLessThan(without.length);
    for (const m of withObstacle) {
      const far = Math.abs(m.local_u_m - 5) > 1 || Math.abs(m.local_v_m - 4) > 1;
      expect(far).toBe(true);
    }
  });

  it("respecte les zones interdites et le plafond de modules", () => {
    const limited = gridLayout(plane, SPEC, [], {
      setback_m: 0.4,
      row_gap_m: 0.02,
      col_gap_m: 0.02,
      orientation: "portrait",
      forbidden: [],
      max_modules: 5,
    });
    expect(limited).toHaveLength(5);
  });

  it("réduit le polygone sans l'inverser", () => {
    const square = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ];
    const inset = insetPolygon(square, 0.5);
    expect(polygonArea(inset)).toBeLessThan(polygonArea(square));
    expect(polygonArea(inset)).toBeGreaterThan(0);
  });

  it("calcule la puissance crête", () => {
    expect(powerKwc(12, 450)).toBe(5.4);
  });
});

describe("synthèse", () => {
  const planes = buildRoofPlanes({ ...DEFAULT_BUILDING_PARAMS, overhang_m: 0 });

  it("ignore les panneaux désactivés", () => {
    const modules = [
      { id: "1", roof_plane_key: "p1", grid_row: 0, grid_col: 0, local_u_m: 1, local_v_m: 1, orientation: "portrait" as const, enabled: true },
      { id: "2", roof_plane_key: "p1", grid_row: 0, grid_col: 1, local_u_m: 2, local_v_m: 1, orientation: "portrait" as const, enabled: false },
    ];
    const summary = computeSolarSummary(planes, modules, SPEC, "pre_etude");
    expect(summary.module_count).toBe(1);
    expect(summary.power_kwc).toBe(0.45);
    expect(summary.main_azimuth_deg).toBe(180);
    expect(summary.coverage_pct).toBeGreaterThan(0);
    expect(summary.quality_level).toBe("pre_etude");
  });

  it("reste neutre sans panneau ni catalogue", () => {
    const summary = computeSolarSummary(planes, [], null, "terrain_verifie");
    expect(summary.module_count).toBe(0);
    expect(summary.power_kwc).toBe(0);
    expect(summary.main_azimuth_deg).toBeNull();
    expect(summary.roof_area_m2).toBeGreaterThan(0);
  });
});

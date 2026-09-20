import { describe, expect, it } from "vitest";
import {
  clampTilt,
  customPlanesFromGeometry,
  edgeLengths,
  groundToPlaneUv,
  insertVertexOnEdge,
  marginForEdge,
  moveVertexTo,
  nearestEdge,
  nextPlaneKey,
  nextPlaneName,
  parseCustomPlanes,
  planeFromCustom,
  planeGroundRing,
  removeVertexAt,
  ringSelfIntersects,
  snapDrawPoint,
  totalCustomArea,
  translateRing,
  validateRoofRing,
  type CustomRoofPlane,
} from "@/lib/solar/polygon";
import { polygonArea, pointInPolygon } from "@/lib/solar/geo";
import { buildRoofPlanes } from "@/lib/solar/roof";
import { DEFAULT_BUILDING_PARAMS } from "@/lib/solar/types";

const square = [
  { x: 0, y: 0 },
  { x: 8, y: 0 },
  { x: 8, y: 6 },
  { x: 0, y: 6 },
];

const plane = (over?: Partial<CustomRoofPlane>): CustomRoofPlane => ({
  key: "pan1",
  name: "Pan 1",
  ring: square,
  tilt_deg: 30,
  azimuth_deg: 180,
  eave_height_m: 3,
  margin_m: 0.4,
  edge_margins: [],
  ...over,
});

describe("validation d'un contour de pan", () => {
  it("accepte un rectangle et renvoie surface et longueurs", () => {
    const v = validateRoofRing(square);
    expect(v.valid).toBe(true);
    expect(v.area_m2).toBeCloseTo(48, 6);
    expect(v.edges).toEqual([8, 6, 8, 6]);
  });

  it("refuse moins de 3 sommets", () => {
    const v = validateRoofRing([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
    ]);
    expect(v.valid).toBe(false);
    expect(v.issue).toBe("too_few_points");
    expect(v.message).toBeTruthy();
  });

  it("refuse un contour qui se croise", () => {
    const bowtie = [
      { x: 0, y: 0 },
      { x: 8, y: 6 },
      { x: 8, y: 0 },
      { x: 0, y: 6 },
    ];
    expect(ringSelfIntersects(bowtie)).toBe(true);
    expect(validateRoofRing(bowtie).issue).toBe("self_intersection");
  });

  it("refuse un segment quasi nul", () => {
    const ring = [...square, { x: 0.01, y: 6 }];
    expect(validateRoofRing(ring).issue).toBe("tiny_edge");
  });

  it("refuse une surface négligeable", () => {
    const sliver = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 0, y: 0.35 },
    ];
    expect(validateRoofRing(sliver).issue).toBe("tiny_area");
  });

  it("refuse une coordonnée invalide ou hors zone", () => {
    expect(validateRoofRing([...square.slice(0, 3), { x: Number.NaN, y: 6 }]).issue).toBe(
      "invalid_coordinate",
    );
    expect(validateRoofRing([...square.slice(0, 3), { x: 99999, y: 6 }]).issue).toBe(
      "invalid_coordinate",
    );
  });
});

describe("édition des sommets", () => {
  it("insère un sommet sur une arête sans casser le contour", () => {
    const next = insertVertexOnEdge(square, 0, { x: 4, y: 0 });
    expect(next).toHaveLength(5);
    expect(validateRoofRing(next).valid).toBe(true);
    expect(polygonArea(next)).toBeCloseTo(48, 6);
  });

  it("supprime un sommet quand le pan reste valide", () => {
    const five = insertVertexOnEdge(square, 0, { x: 4, y: 0 });
    const back = removeVertexAt(five, 1);
    expect(validateRoofRing(back).valid).toBe(true);
    expect(back).toHaveLength(4);
  });

  it("refuse la suppression qui laisse moins de 3 sommets", () => {
    const triangle = [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 0, y: 6 },
    ];
    expect(validateRoofRing(removeVertexAt(triangle, 0)).valid).toBe(false);
  });

  it("déplace un sommet et met la surface à jour", () => {
    const moved = moveVertexTo(square, 2, { x: 12, y: 6 });
    expect(validateRoofRing(moved).area_m2).toBeGreaterThan(48);
  });

  it("déplace le pan entier sans changer sa surface", () => {
    const moved = translateRing(square, 5, -3);
    expect(polygonArea(moved)).toBeCloseTo(48, 6);
    expect(moved[0]).toEqual({ x: 5, y: -3 });
  });

  it("trouve l'arête la plus proche et sa projection", () => {
    const edge = nearestEdge(square, { x: 4, y: -0.2 });
    expect(edge?.index).toBe(0);
    expect(edge?.point.x).toBeCloseTo(4, 6);
    expect(edge?.distance).toBeCloseTo(0.2, 6);
  });
});

describe("accrochage", () => {
  it("s'accroche à un sommet existant", () => {
    const r = snapDrawPoint({ x: 8.2, y: 0.1 }, { rings: [square] });
    expect(r.kind).toBe("sommet");
    expect(r.point).toEqual({ x: 8, y: 0 });
  });

  it("s'accroche à une arête quand aucun sommet n'est proche", () => {
    const r = snapDrawPoint({ x: 4, y: 0.3 }, { rings: [square] });
    expect(r.kind).toBe("arete");
    expect(r.point.y).toBeCloseTo(0, 6);
  });

  it("aligne sur le point précédent", () => {
    const r = snapDrawPoint({ x: 20.3, y: 30 }, { rings: [], previous: { x: 20, y: 10 } });
    expect(r.kind).toBe("alignement");
    expect(r.point.x).toBe(20);
  });

  it("peut être désactivé (touche Alt)", () => {
    const r = snapDrawPoint({ x: 8.2, y: 0.1 }, { rings: [square], enabled: false });
    expect(r.kind).toBeNull();
    expect(r.point).toEqual({ x: 8.2, y: 0.1 });
  });
});

describe("géométrie du pan incliné", () => {
  it("conserve la longueur du faîtage et allonge la pente", () => {
    const geo = planeFromCustom(plane());
    expect(geo.tilt_deg).toBe(30);
    // Surface inclinée = surface au sol / cos(pente).
    expect(geo.area_m2).toBeCloseTo(48 / Math.cos((30 * Math.PI) / 180), 6);
    expect(geo.ridge_height_m).toBeGreaterThan(geo.eave_height_m);
  });

  it("revient exactement au contour au sol (aucune copie divergente 2D/3D)", () => {
    const geo = planeFromCustom(plane());
    const back = planeGroundRing(geo);
    back.forEach((p, i) => {
      expect(p.x).toBeCloseTo(square[i]!.x, 6);
      expect(p.y).toBeCloseTo(square[i]!.y, 6);
    });
  });

  it("une toiture plate garde la surface au sol", () => {
    expect(planeFromCustom(plane({ tilt_deg: 0 })).area_m2).toBeCloseTo(48, 6);
  });

  it("borne la pente à 70°", () => {
    expect(clampTilt(120)).toBe(70);
    expect(clampTilt(Number.NaN)).toBe(0);
  });

  it("gère plusieurs pans et leur surface totale", () => {
    const planes = [
      plane(),
      plane({ key: "pan2", name: "Pan 2", ring: translateRing(square, 20, 0) }),
    ];
    expect(totalCustomArea(planes)).toBeCloseTo(planeFromCustom(planes[0]!).area_m2 * 2, 6);
  });
});

describe("obstacles et marges", () => {
  it("détecte un obstacle à l'intérieur ou hors du pan", () => {
    const geo = planeFromCustom(plane());
    const inside = groundToPlaneUv({ x: 4, y: 3 }, 180, 30);
    const outside = groundToPlaneUv({ x: 40, y: 3 }, 180, 30);
    expect(pointInPolygon(inside, geo.polygon)).toBe(true);
    expect(pointInPolygon(outside, geo.polygon)).toBe(false);
  });

  it("applique la marge dédiée d'une arête, sinon celle du pan", () => {
    const p = plane({ edge_margins: [{ index: 1, kind: "faitage", margin_m: 1.2 }] });
    expect(marginForEdge(p, 1)).toBe(1.2);
    expect(marginForEdge(p, 0)).toBe(0.4);
  });

  it("donne les longueurs d'arêtes du contour", () => {
    expect(edgeLengths(square)).toEqual([8, 6, 8, 6]);
  });
});

describe("compatibilité avec les toitures paramétriques", () => {
  it("convertit les pans calculés en contours éditables valides", () => {
    const geometry = buildRoofPlanes(DEFAULT_BUILDING_PARAMS);
    const custom = customPlanesFromGeometry(geometry);
    expect(custom).toHaveLength(geometry.length);
    for (const c of custom) {
      expect(validateRoofRing(c.ring).valid).toBe(true);
    }
    // Les clés stables sont conservées : les implantations ne sont pas orphelines.
    expect(custom.map((c) => c.key)).toEqual(geometry.map((g) => g.key));
  });

  it("restitue la même géométrie après conversion", () => {
    const geometry = buildRoofPlanes(DEFAULT_BUILDING_PARAMS);
    const custom = customPlanesFromGeometry(geometry);
    custom.forEach((c, i) => {
      expect(planeFromCustom(c).area_m2).toBeCloseTo(geometry[i]!.area_m2, 3);
    });
  });
});

describe("lecture des pans enregistrés", () => {
  it("ignore une entrée dont le contour est invalide", () => {
    const parsed = parseCustomPlanes([
      plane(),
      { key: "pan2", name: "Pan 2", ring: [{ x: 0, y: 0 }] },
      null,
      "n'importe quoi",
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.key).toBe("pan1");
  });

  it("complète les valeurs manquantes sans inventer de contour", () => {
    const parsed = parseCustomPlanes([{ key: "pan1", ring: square }], {
      tilt_deg: 25,
      eave_height_m: 4,
    });
    expect(parsed[0]!.tilt_deg).toBe(25);
    expect(parsed[0]!.eave_height_m).toBe(4);
    expect(parsed[0]!.name).toBe("pan1");
  });

  it("retourne une liste vide pour une valeur non exploitable", () => {
    expect(parseCustomPlanes(null)).toEqual([]);
    expect(parseCustomPlanes({})).toEqual([]);
  });
});

describe("nommage des pans", () => {
  it("attribue des clés et noms libres", () => {
    expect(nextPlaneKey(["pan1", "pan2"])).toBe("pan3");
    expect(nextPlaneName(["Pan 1", "Pan 3"])).toBe("Pan 2");
  });
});

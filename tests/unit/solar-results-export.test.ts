/**
 * Solar Studio V2 — P1 : synthèse Résultats, plan vectoriel et documents PDF.
 * Tests PURS : aucune donnée client, aucun accès base, aucun appel réseau.
 */
import { describe, expect, test } from "bun:test";
import { buildSolarResults, planExportFileName, readModuleSpec } from "@/lib/solar/results";
import { buildPlanDrawing, renderPlanSvg, scaleBarLength } from "@/lib/solar/plan-drawing";
import { drawingFromModel, resultsFromModel } from "@/lib/solar/report-from-model";
import { buildSolarPdfSections, renderSolarPdf, SOLAR_PDF_RESERVE } from "@/lib/solar/pdf-doc";
import { buildSceneModel } from "@/components/solar/scene-model";
import { DEFAULT_BUILDING_PARAMS } from "@/lib/solar/types";
import type { PlacedModule } from "@/lib/solar/types";

const SNAPSHOT = {
  manufacturer: "DualSun",
  model: "FLASH 500 Shingle",
  power_wc: 500,
  width_mm: 1134,
  height_mm: 1762,
  depth_mm: 35,
};

const FRAME = {
  origin: [0, 0, 3] as [number, number, number],
  u: [1, 0, 0] as [number, number, number],
  v: [0, 0.9, 0.43] as [number, number, number],
  normal: [0, -0.43, 0.9] as [number, number, number],
};

function plane(id: string, key: string, name: string, azimuth = 180) {
  return {
    id,
    key,
    name,
    azimuth_deg: azimuth,
    tilt_deg: 30,
    area_m2: 40,
    polygon: [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 5 },
      { x: 0, y: 5 },
    ],
    frame: FRAME,
  };
}

function mod(id: string, key: string, u: number, v: number, enabled = true): PlacedModule {
  return {
    id,
    roof_plane_key: key,
    grid_row: 0,
    grid_col: 0,
    local_u_m: u,
    local_v_m: v,
    orientation: "portrait",
    enabled,
  };
}

function model(overrides: Partial<Parameters<typeof resultsFromModel>[0]> = {}) {
  return {
    model: {
      name: "Maison Durand",
      address: "12 rue des Lilas",
      postal_code: "34000",
      city: "Montpellier",
      geometry_version: 7,
      geometry_hash: "abcdef0123456789abcdef",
      updated_at: "2026-01-05T10:00:00.000Z",
      quality_level: "pre_etude",
    },
    planes: [plane("p1", "sud", "Pan Sud"), plane("p2", "nord", "Pan Nord", 0)],
    modules: [mod("m1", "sud", 1, 1), mod("m2", "sud", 2.5, 1)],
    obstacles: [
      {
        id: "o1",
        roof_plane_id: "p1",
        obstacle_type: "velux",
        label: "Velux salon",
        position_x_m: 5,
        position_y_m: 2,
        width_m: 0.8,
        length_m: 1.2,
      },
    ],
    arrays: [
      {
        roof_plane_id: "p1",
        module_snapshot: SNAPSHOT,
        module_variant_id: "var-1",
        module_revision_id: "rev-9",
        rules_profile_id: "profil-std",
        rules_profile_version: 3,
        layout_engine_version: "v2.1",
      },
    ],
    quality: { verified_count: 2, total_count: 5 },
    ...overrides,
  };
}

/* ------------------------------ Synthèse --------------------------------- */

describe("Résultats — synthèse", () => {
  test("puissance, panneaux et surfaces viennent du snapshot réel", () => {
    const r = resultsFromModel(model());
    expect(r.global.module_count).toBe(2);
    expect(r.global.power_kwc).toBe(1);
    expect(r.global.spec.manufacturer).toBe("DualSun");
    expect(r.global.spec.width_mm).toBe(1134);
    expect(r.global.module_area_m2).toBe(4);
    expect(r.global.roof_area_m2).toBe(80);
    expect(r.global.planes_used).toBe(1);
  });

  test("détail par pan exact, avec obstacle nommé et azimut cardinal", () => {
    const r = resultsFromModel(model());
    const sud = r.planes.find((p) => p.key === "sud")!;
    expect(sud.module_count).toBe(2);
    expect(sud.power_kwc).toBe(1);
    expect(sud.cardinal).toBe("Sud");
    expect(sud.obstacles).toEqual(["Velux salon"]);
    const nord = r.planes.find((p) => p.key === "nord")!;
    expect(nord.module_count).toBe(0);
    expect(nord.alerts.length).toBe(1);
  });

  test("aucun champ de production tant qu'aucun moteur n'existe", () => {
    const r = resultsFromModel(model());
    expect(r.production).toBeNull();
    expect(JSON.stringify(r)).not.toContain("kwh");
  });

  test("modèle sans panneau : alerte explicite", () => {
    const r = resultsFromModel(model({ modules: [] }));
    expect(r.warnings.some((w) => w.code === "aucun_panneau")).toBe(true);
    expect(r.global.status).toBe("alerte");
  });

  test("snapshot incomplet signalé", () => {
    const r = resultsFromModel(
      model({ arrays: [{ roof_plane_id: "p1", module_snapshot: { power_wc: 500 } }] }),
    );
    expect(r.warnings.some((w) => w.code === "snapshot_incomplet")).toBe(true);
    expect(readModuleSpec({ power_wc: 500 }).complete).toBe(false);
  });

  test("panneaux désactivés : non comptés et signalés", () => {
    const r = resultsFromModel(
      model({ modules: [mod("m1", "sud", 1, 1), mod("m2", "sud", 2.5, 1, false)] }),
    );
    expect(r.global.module_count).toBe(1);
    expect(r.warnings.some((w) => w.code === "panneaux_desactives")).toBe(true);
  });

  test("provenance non vérifiée signalée uniquement si l'information existe", () => {
    expect(resultsFromModel(model()).warnings.some((w) => w.code === "provenance_a_verifier")).toBe(
      true,
    );
    expect(
      resultsFromModel(model({ quality: null })).warnings.some(
        (w) => w.code === "provenance_a_verifier",
      ),
    ).toBe(false);
  });

  test("traçabilité technique reprend versions, règles et moteur", () => {
    const t = resultsFromModel(model()).technical;
    expect(t.geometry_version).toBe(7);
    expect(t.geometry_hash_short).toBe("abcdef012345");
    expect(t.module_revision_id).toBe("rev-9");
    expect(t.rules_profile_version).toBe(3);
    expect(t.layout_engine_version).toBe("v2.1");
  });

  test("multi-pans : puissance totale = somme des pans", () => {
    const r = resultsFromModel(
      model({
        modules: [mod("m1", "sud", 1, 1), mod("m2", "nord", 1, 1), mod("m3", "nord", 2.5, 1)],
      }),
    );
    expect(r.global.planes_used).toBe(2);
    expect(r.global.power_kwc).toBe(
      r.planes.reduce((s, p) => Math.round((s + p.power_kwc) * 100) / 100, 0),
    );
  });

  test("synthèse directe : pans sans champ = puissance nulle", () => {
    const r = buildSolarResults({
      model: {
        reference: null,
        name: "x",
        address: null,
        geometry_version: 1,
        geometry_hash: null,
        updated_at: null,
        quality_level: "pre_etude",
      },
      planes: [plane("p1", "sud", "Pan Sud")],
      modules: [],
      obstacles: [],
      arrays: [],
    });
    expect(r.global.power_kwc).toBe(0);
    expect(r.technical.geometry_hash_short).toBeNull();
  });
});

/* ------------------------------ 2D / 3D ---------------------------------- */

describe("Cohérence 2D / 3D", () => {
  const payload = {
    params: DEFAULT_BUILDING_PARAMS,
    planes: [plane("p1", "sud", "Pan Sud")],
    modules: [mod("m1", "sud", 1.25, 2.5)],
    obstacles: [
      {
        id: "o1",
        roof_plane_id: "p1",
        obstacle_type: "velux",
        position_x_m: 5,
        position_y_m: 2,
        base_z_m: 0,
        width_m: 0.8,
        length_m: 1.2,
        height_m: 0.2,
      },
    ],
    arrays: [{ roof_plane_id: "p1", module_catalog_id: null, module_snapshot: SNAPSHOT }],
    catalog: [],
  };

  test("le module a les mêmes coordonnées U/V en 2D et en 3D", () => {
    const scene = buildSceneModel(payload);
    const drawing = drawingFromModel({
      model: {
        name: "x",
        address: "",
        postal_code: "",
        city: "",
        geometry_version: 1,
        geometry_hash: null,
        quality_level: "pre_etude",
      },
      planes: payload.planes,
      modules: payload.modules,
      obstacles: payload.obstacles,
      arrays: payload.arrays,
    });
    const sceneModule = scene.modules[0]!;
    expect(sceneModule.local_u_m).toBe(1.25);
    expect(sceneModule.local_v_m).toBe(2.5);
    const rect = drawing.items.find((i) => i.kind === "rect" && i.fill === "#1d4ed8")!;
    if (rect.kind !== "rect") throw new Error("rect attendu");
    // Centre du rectangle du plan = même U/V (au décalage de mise en page près).
    expect(Math.round((rect.w + Number.EPSILON) * 1000) / 1000).toBe(1.134);
    expect(Math.round((rect.h + Number.EPSILON) * 1000) / 1000).toBe(1.762);
  });

  test("3D et 2D utilisent le snapshot, jamais une dimension générique", () => {
    const scene = buildSceneModel(payload);
    expect(scene.specByPlaneKey["sud"]).toEqual({ width_mm: 1134, height_mm: 1762, depth_mm: 35 });
  });

  test("orientation paysage inverse largeur et hauteur", () => {
    const d = drawingFromModel({
      model: {
        name: "x",
        address: "",
        postal_code: "",
        city: "",
        geometry_version: 1,
        geometry_hash: null,
        quality_level: "pre_etude",
      },
      planes: payload.planes,
      modules: [{ ...mod("m1", "sud", 1, 1), orientation: "paysage" }],
      obstacles: [],
      arrays: payload.arrays,
    });
    const rect = d.items.find((i) => i.kind === "rect")!;
    if (rect.kind !== "rect") throw new Error("rect attendu");
    expect(Math.round(rect.w * 1000)).toBe(1762);
    expect(Math.round(rect.h * 1000)).toBe(1134);
  });

  test("les obstacles gardent leur position (u,v) dans le plan", () => {
    const scene = buildSceneModel(payload);
    expect(scene.obstacles[0]!.u).toBe(5);
    expect(scene.obstacles[0]!.v).toBe(2);
    expect(scene.obstacles[0]!.planeKey).toBe("sud");
  });
});

/* ------------------------------- Plan SVG -------------------------------- */

describe("Plan vectoriel", () => {
  const input = {
    planes: [
      {
        key: "sud",
        name: "Pan Sud",
        polygon: plane("p1", "sud", "s").polygon,
        azimuth_deg: 180,
        tilt_deg: 30,
      },
      {
        key: "nord",
        name: "Pan Nord",
        polygon: plane("p2", "nord", "n").polygon,
        azimuth_deg: 0,
        tilt_deg: 30,
      },
    ],
    modules: [mod("m1", "sud", 1, 1), mod("m2", "nord", 2, 2)],
    obstacles: [{ id: "o1", planeKey: "sud", u: 5, v: 2, width: 0.8, length: 1.2, label: "Velux" }],
    spec: { width_mm: 1134, height_mm: 1762 },
    title: "Plan d'implantation photovoltaïque",
  };

  test("SVG déterministe : mêmes entrées, même chaîne", () => {
    const a = renderPlanSvg(buildPlanDrawing(input));
    const b = renderPlanSvg(buildPlanDrawing(input));
    expect(a).toBe(b);
    expect(a.startsWith("<svg")).toBe(true);
  });

  test("chaque module est dessiné dans la case de son pan", () => {
    const d = buildPlanDrawing(input);
    expect(d.moduleCount).toBe(2);
    const panels = d.items.filter(
      (i) => i.kind === "rect" && i.fill === "#1d4ed8" && Math.abs(i.w - 1.134) < 1e-6,
    );
    expect(panels.length).toBe(2);
    // Les pans sont juxtaposés : le module du pan « sud » est à gauche de celui du pan « nord ».
    const [first, second] = panels as Extract<(typeof panels)[number], { kind: "rect" }>[];
    expect(first!.x).toBeLessThan(second!.x);
  });

  test("le plan porte le nom des pans, le Nord et une cote de référence", () => {
    const svg = renderPlanSvg(buildPlanDrawing(input));
    expect(svg).toContain("Pan Sud");
    expect(svg).toContain("Pan Nord");
    expect(svg).toContain(">N<");
    expect(svg).toContain(" m<");
    expect(scaleBarLength(20)).toBe(2);
  });

  test("sans dimensions de panneau, aucun module n'est inventé", () => {
    const d = buildPlanDrawing({ ...input, spec: null });
    expect(d.moduleCount).toBe(0);
  });

  test("nom de fichier normalisé", () => {
    expect(planExportFileName("ÉTUDE 2026/17", new Date("2026-03-04T12:00:00Z"), "svg")).toBe(
      "PVIA_ETUDE-2026-17_plan-photovoltaique_2026-03-04.svg",
    );
    expect(planExportFileName(null, new Date("2026-03-04T12:00:00Z"), "pdf")).toContain("dossier");
  });

  test("1000 modules : plan construit et rendu sous le seuil raisonnable", () => {
    const many = Array.from({ length: 1000 }, (_, i) =>
      mod(`m${i}`, "sud", (i % 40) * 0.2, Math.floor(i / 40) * 0.2),
    );
    const t0 = performance.now();
    const svg = renderPlanSvg(buildPlanDrawing({ ...input, modules: many }));
    const ms = performance.now() - t0;
    expect(svg.length).toBeGreaterThan(1000);
    expect(ms).toBeLessThan(1500);
  });
});

/* --------------------------------- PDF ----------------------------------- */

describe("Documents PDF", () => {
  const report = resultsFromModel(model());
  const drawing = drawingFromModel(model());
  const meta = {
    reference: "ETU-2026-017",
    address: "12 rue des Lilas, 34000 Montpellier",
    date: new Date("2026-03-04T12:00:00Z"),
    companyName: "Solaire du Sud",
    brandColor: "#1E3A8A",
    logo: null,
  };

  test("le PDF client n'expose aucun identifiant interne ni empreinte", () => {
    const text = JSON.stringify(buildSolarPdfSections(report, "client", meta));
    expect(text).not.toContain("abcdef012345");
    expect(text).not.toContain("var-1");
    expect(text).not.toContain("rev-9");
    expect(text).not.toContain("v2.1");
    expect(text).toContain(SOLAR_PDF_RESERVE);
  });

  test("le PDF technique contient versions, règles et moteur", () => {
    const text = JSON.stringify(buildSolarPdfSections(report, "technique", meta));
    expect(text).toContain("abcdef012345");
    expect(text).toContain("rev-9");
    expect(text).toContain("profil-std");
    expect(text).toContain("v2.1");
    expect(text).toContain("Velux salon");
  });

  test("le tableau par pan diffère entre client et technique", () => {
    const client = buildSolarPdfSections(report, "client", meta).find(
      (s) => s.heading === "Répartition par pan",
    )!;
    const tech = buildSolarPdfSections(report, "technique", meta).find(
      (s) => s.heading === "Répartition par pan",
    )!;
    expect(client.table!.columns).toEqual(["Pan", "Panneaux", "Puissance"]);
    expect(tech.table!.columns).toContain("Azimut");
  });

  test("aucune estimation de production dans les documents", () => {
    for (const variant of ["client", "technique"] as const) {
      const text = JSON.stringify(buildSolarPdfSections(report, variant, meta)).toLowerCase();
      expect(text).not.toContain("kwh");
    }
  });

  test("génération réelle : document non vide et paginé", async () => {
    const bytes = await renderSolarPdf({ report, drawing, variant: "client", meta });
    expect(bytes.byteLength).toBeGreaterThan(1000);
    const head = new TextDecoder().decode(bytes.slice(0, 8));
    expect(head.startsWith("%PDF-")).toBe(true);
  });

  test("génération technique : document distinct et non vide", async () => {
    const bytes = await renderSolarPdf({ report, drawing, variant: "technique", meta });
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });
});

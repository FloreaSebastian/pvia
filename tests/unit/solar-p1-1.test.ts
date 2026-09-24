/**
 * Solar Studio V2 — P1.1 : corrections après audit indépendant.
 * Tests PURS : aucune donnée client, aucun accès base, aucun appel réseau réel.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resultsFromModel, drawingFromModel } from "@/lib/solar/report-from-model";
import {
  buildPlanDrawing,
  localPointFromPlan,
  planPointForPlane,
  renderPlanSvg,
} from "@/lib/solar/plan-drawing";
import { buildSolarPdfSections } from "@/lib/solar/pdf-doc";
import { buildSceneModel } from "@/components/solar/scene-model";
import { DEFAULT_BUILDING_PARAMS, type PlacedModule } from "@/lib/solar/types";
import { describeSelectedModule, resolveModuleSelection } from "@/lib/solar/scene-selection";
import {
  PDF_LOGO_MAX_BYTES,
  contentLengthAcceptable,
  fetchLogoSafely,
  isProjectStorageUrl,
  readBounded,
  sniffLogoType,
} from "@/lib/solar/logo-policy";
import { runSolarExport } from "@/lib/solar/export-pipeline";

const S500 = {
  manufacturer: "DualSun",
  model: "FLASH 500",
  power_wc: 500,
  width_mm: 1134,
  height_mm: 1762,
  depth_mm: 35,
};
const S400 = {
  manufacturer: "SunPower",
  model: "MAX3 400",
  power_wc: 400,
  width_mm: 1046,
  height_mm: 1690,
  depth_mm: 40,
};

const FRAME = {
  origin: [0, 0, 3] as [number, number, number],
  u: [1, 0, 0] as [number, number, number],
  v: [0, 0.9, 0.43] as [number, number, number],
  normal: [0, -0.43, 0.9] as [number, number, number],
};

function plane(id: string, key: string, name: string, offset = 0) {
  return {
    id,
    key,
    name,
    azimuth_deg: 180,
    tilt_deg: 30,
    area_m2: 40,
    polygon: [
      { x: offset, y: offset },
      { x: offset + 8, y: offset },
      { x: offset + 8, y: offset + 5 },
      { x: offset, y: offset + 5 },
    ],
    frame: FRAME,
  };
}

function mod(
  id: string,
  key: string,
  u: number,
  v: number,
  extra: Partial<PlacedModule> = {},
): PlacedModule {
  return {
    id,
    roof_plane_key: key,
    grid_row: 0,
    grid_col: 0,
    local_u_m: u,
    local_v_m: v,
    orientation: "portrait",
    enabled: true,
    ...extra,
  };
}

const MODEL = {
  name: "x",
  address: "1 rue A",
  postal_code: "34000",
  city: "Montpellier",
  geometry_version: 3,
  geometry_hash: "abcdef0123456789",
  updated_at: null,
  quality_level: "pre_etude",
};

function twoArrays(modules?: PlacedModule[]) {
  return {
    model: MODEL,
    planes: [plane("p1", "a", "Pan A"), plane("p2", "b", "Pan B")],
    modules: modules ?? [
      mod("m1", "a", 1, 1),
      mod("m2", "a", 2.5, 1),
      mod("m3", "b", 1, 1),
      mod("m4", "b", 2.5, 1),
      mod("m5", "b", 4, 1),
    ],
    obstacles: [],
    arrays: [
      {
        roof_plane_id: "p1",
        module_snapshot: S500,
        module_variant_id: "var-500",
        module_revision_id: "rev-500",
        rules_profile_id: "std",
        rules_profile_version: 2,
        layout_engine_version: "v2.1",
      },
      {
        roof_plane_id: "p2",
        module_snapshot: S400,
        module_variant_id: "var-400",
        module_revision_id: "rev-400",
        rules_profile_id: "std",
        rules_profile_version: 3,
        layout_engine_version: "v2.2",
      },
    ],
  };
}

const META = {
  reference: "ETU-1",
  address: "1 rue A",
  date: new Date("2026-03-04T12:00:00Z"),
  companyName: "Solaire",
  brandColor: "#1E3A8A",
  logo: null,
};

/* --------------------------- 1. Multi-array ------------------------------ */

describe("P1.1 — plusieurs champs / plusieurs références", () => {
  test("puissance exacte : 2 × 500 W + 3 × 400 W = 2,2 kWc", () => {
    const r = resultsFromModel(twoArrays());
    expect(r.planes.find((p) => p.key === "a")!.power_kwc).toBe(1);
    expect(r.planes.find((p) => p.key === "b")!.power_kwc).toBe(1.2);
    expect(r.global.power_kwc).toBe(2.2);
    expect(r.global.power_complete).toBe(true);
  });

  test("surface exacte : chaque pan utilise les dimensions de son snapshot", () => {
    const r = resultsFromModel(twoArrays());
    const a = 2 * 1.134 * 1.762;
    const b = 3 * 1.046 * 1.69;
    expect(r.planes.find((p) => p.key === "a")!.module_area_m2).toBe(Math.round(a * 10) / 10);
    expect(r.planes.find((p) => p.key === "b")!.module_area_m2).toBe(Math.round(b * 10) / 10);
    expect(r.global.module_area_m2).toBeCloseTo(
      Math.round(a * 10) / 10 + Math.round(b * 10) / 10,
      5,
    );
  });

  test("2 fabricants : aucune référence unique prétendue", () => {
    const r = resultsFromModel(twoArrays());
    expect(r.global.module_types.length).toBe(2);
    expect(r.global.spec.manufacturer).toBeNull();
    expect(r.global.spec.model).toBeNull();
    const t400 = r.global.module_types.find((t) => t.power_wc === 400)!;
    expect(t400.module_count).toBe(3);
    expect(t400.power_kwc).toBe(1.2);
    const client = JSON.stringify(buildSolarPdfSections(r, "client", META));
    expect(client).toContain("2 références de panneaux");
    expect(client).toContain("DualSun FLASH 500");
    expect(client).toContain("SunPower MAX3 400");
  });

  test("traçabilité : toutes les configurations sont listées (technique seulement)", () => {
    const r = resultsFromModel(twoArrays());
    expect(r.technical.configurations.map((c) => c.module_revision_id)).toEqual([
      "rev-500",
      "rev-400",
    ]);
    expect(r.technical.module_revision_id).toBeNull();
    const tech = JSON.stringify(buildSolarPdfSections(r, "technique", META));
    expect(tech).toContain("rev-500");
    expect(tech).toContain("rev-400");
    expect(tech).toContain("v2.2");
    const client = JSON.stringify(buildSolarPdfSections(r, "client", META));
    expect(client).not.toContain("rev-400");
    expect(client).not.toContain("var-500");
    expect(client).not.toContain("v2.2");
  });

  test("SVG : rectangles aux dimensions du snapshot de chaque pan", () => {
    const d = drawingFromModel(twoArrays());
    const rect = (id: string) => {
      const it = d.items.find((i) => i.kind === "rect" && i.moduleId === id);
      if (!it || it.kind !== "rect") throw new Error("rect attendu");
      return it;
    };
    expect(rect("m1").w).toBeCloseTo(1.134, 9);
    expect(rect("m1").h).toBeCloseTo(1.762, 9);
    expect(rect("m3").w).toBeCloseTo(1.046, 9);
    expect(rect("m3").h).toBeCloseTo(1.69, 9);
    expect(renderPlanSvg(d)).toContain("2 formats de panneaux");
  });

  test("paysage appliqué après résolution du snapshot du bon pan", () => {
    const d = drawingFromModel(
      twoArrays([
        mod("m1", "a", 2, 2, { orientation: "paysage" }),
        mod("m3", "b", 2, 2, { orientation: "paysage" }),
      ]),
    );
    const m3 = d.items.find((i) => i.kind === "rect" && i.moduleId === "m3");
    if (!m3 || m3.kind !== "rect") throw new Error("rect attendu");
    expect(m3.w).toBeCloseTo(1.69, 9);
    expect(m3.h).toBeCloseTo(1.046, 9);
  });

  test("pan sans champ : avertissement, aucune valeur inventée", () => {
    const input = twoArrays();
    input.arrays = [input.arrays[0]!];
    const r = resultsFromModel(input);
    const b = r.planes.find((p) => p.key === "b")!;
    expect(b.power_known).toBe(false);
    expect(b.unknown_count).toBe(3);
    expect(b.power_kwc).toBe(0);
    expect(b.module_area_m2).toBe(0);
    expect(r.global.power_kwc).toBe(1);
    expect(r.global.power_complete).toBe(false);
    expect(r.warnings.some((w) => w.code === "module_sans_fiche")).toBe(true);
    expect(r.global.status).toBe("alerte");
    const d = drawingFromModel(input);
    expect(d.moduleCount).toBe(2);
    expect(d.undrawnCount).toBe(3);
  });
});

/* ------------------------------ 2. Validité ------------------------------ */

describe("P1.1 — validité des panneaux", () => {
  test("tous valides : statut ok", () => {
    const r = resultsFromModel(twoArrays());
    expect(r.global.status).toBe("ok");
    expect(r.global.invalid_count).toBe(0);
  });

  test("warning : alerte, compte par pan et cause remontée", () => {
    const r = resultsFromModel(
      twoArrays([
        mod("m1", "a", 1, 1),
        mod("m2", "a", 2.5, 1, { validity_status: "warning", validity_cause: "marge_reduite" }),
        mod("m3", "b", 1, 1),
      ]),
    );
    expect(r.planes.find((p) => p.key === "a")!.warning_count).toBe(1);
    expect(r.global.warning_count).toBe(1);
    const w = r.warnings.find((x) => x.code === "modules_a_verifier")!;
    expect(w.message).toContain("marge_reduite");
    expect(r.global.status).toBe("alerte");
  });

  test("invalid : alerte, compte par pan et cause remontée", () => {
    const r = resultsFromModel(
      twoArrays([
        mod("m1", "a", 1, 1),
        mod("m3", "b", 1, 1, { validity_status: "invalid", validity_cause: "hors_pan" }),
      ]),
    );
    expect(r.planes.find((p) => p.key === "b")!.invalid_count).toBe(1);
    expect(r.global.invalid_count).toBe(1);
    expect(r.warnings.find((x) => x.code === "modules_invalides")!.message).toContain("hors_pan");
    expect(r.global.status).toBe("alerte");
  });

  test("le badge « Géométrie cohérente » dépend du statut global", () => {
    const src = readFileSync("src/components/solar/studio/ResultsView.tsx", "utf8");
    expect(src).toContain('g.status === "ok" ? "Géométrie cohérente"');
  });

  test("le chargement serveur conserve validity_status / validity_cause", () => {
    const src = readFileSync("src/lib/solar.server.ts", "utf8");
    expect(src).toContain("validity_status: normalizeValidityStatus(m.validity_status)");
    expect(src).toContain("validity_cause: m.validity_cause ?? null");
  });
});

/* ------------------------------ 3. Nord ---------------------------------- */

describe("P1.1 — aucun Nord global", () => {
  test("SVG et PDF sans flèche ni mention Nord globale", () => {
    const input = twoArrays();
    input.planes = [plane("p1", "a", "Pan A"), plane("p2", "b", "Pan B")];
    const d = drawingFromModel(input);
    const svg = renderPlanSvg(d);
    expect(svg).not.toContain(">N<");
    expect(svg.toLowerCase()).not.toContain("nord");
    expect(d.items.some((i) => i.kind === "text" && i.text.trim() === "N")).toBe(false);
    for (const v of ["client", "technique"] as const) {
      const text = JSON.stringify(
        buildSolarPdfSections(resultsFromModel(input), v, META),
      ).toLowerCase();
      expect(text).not.toContain("flèche nord");
      expect(text).not.toContain("nord géographique");
    }
  });
});

/* ------------------------------ 4. Clic 3D ------------------------------- */

describe("P1.1 — clic panneau 3D = sélection", () => {
  test("sélection du panneau et de son pan, sans écriture", () => {
    const modules = [mod("m1", "a", 1, 1), mod("m3", "b", 2, 2)];
    let writes = 0;
    const toggle = () => {
      writes += 1;
    };
    void toggle;
    expect(resolveModuleSelection(modules, "m3")).toEqual({ moduleId: "m3", planeKey: "b" });
    expect(resolveModuleSelection(modules, "inconnu")).toBeNull();
    expect(writes).toBe(0);
  });

  test("fiche du panneau sélectionné : pan, orientation, U/V, validité", () => {
    const info = describeSelectedModule(
      {
        modules: [
          mod("m3", "b", 2.345, 1.2, { validity_status: "warning", validity_cause: "marge" }),
        ],
        planes: [{ key: "b", name: "Pan B" }],
        panelLabelByPlaneKey: { b: "SunPower MAX3 400" },
      },
      "m3",
    )!;
    expect(info).toMatchObject({
      planeName: "Pan B",
      orientation: "Portrait",
      u: 2.35,
      v: 1.2,
      validity: "warning",
      validityCause: "marge",
      panelLabel: "SunPower MAX3 400",
    });
    expect(describeSelectedModule({ modules: [], planes: [] }, null)).toBeNull();
  });

  test("la scène 3D ne peut plus déclencher d'activation/désactivation", () => {
    const scene = readFileSync("src/components/solar/SolarScene.tsx", "utf8");
    expect(scene).not.toContain("onToggleModule");
    expect(scene).toContain("onPick={(id) => onSelectModule?.(id)}");
    const route = readFileSync(
      "src/routes/_authenticated/cahiers-des-charges.$id_.solar-studio.tsx",
      "utf8",
    );
    const block = route.slice(
      route.indexOf("<SolarScene"),
      route.indexOf("/>", route.indexOf("<SolarScene")),
    );
    expect(block).not.toContain("onToggleModule");
    expect(block).toContain("onSelectModule={onSelectModule3d}");
  });
});

/* --------------------------- 5. U/V 2D ↔ 3D ------------------------------ */

describe("P1.1 — centre U/V exact entre plan et 3D", () => {
  function centreCheck(orientation: "portrait" | "paysage") {
    const input = {
      model: MODEL,
      planes: [plane("p1", "a", "Pan A"), plane("p2", "b", "Pan B", 3)],
      modules: [
        mod("m1", "a", 1.25, 2.5, { orientation }),
        mod("m3", "b", 5.5, 4.75, { orientation }),
      ],
      obstacles: [],
      arrays: twoArrays().arrays,
    };
    const scene = buildSceneModel({
      params: DEFAULT_BUILDING_PARAMS,
      planes: input.planes,
      modules: input.modules,
      obstacles: [],
      arrays: input.arrays.map((a) => ({ ...a, module_catalog_id: null })),
      catalog: [],
    } as never);
    const d = drawingFromModel(input);
    for (const id of ["m1", "m3"]) {
      const sm = scene.modules.find((m) => m.id === id)!;
      const rect = d.items.find((i) => i.kind === "rect" && i.moduleId === id);
      if (!rect || rect.kind !== "rect") throw new Error("rect attendu");
      const local = localPointFromPlan(
        d,
        sm.roof_plane_key,
        rect.x + rect.w / 2,
        rect.y + rect.h / 2,
      )!;
      expect(local.u).toBeCloseTo(sm.local_u_m, 9);
      expect(local.v).toBeCloseTo(sm.local_v_m, 9);
      const back = planPointForPlane(d, sm.roof_plane_key, sm.local_u_m, sm.local_v_m)!;
      expect(back.x).toBeCloseTo(rect.x + rect.w / 2, 9);
    }
    const [la, lb] = d.planeLayouts;
    expect(lb!.dx).not.toBe(la!.dx); // second pan réellement translaté
  }

  test("1 et 2 pans, portrait", () => centreCheck("portrait"));
  test("1 et 2 pans, paysage", () => centreCheck("paysage"));

  test("1 pan seul : centre exact", () => {
    const d = buildPlanDrawing({
      planes: [
        {
          key: "a",
          name: "A",
          polygon: plane("p1", "a", "A").polygon,
          azimuth_deg: 180,
          tilt_deg: 30,
        },
      ],
      modules: [mod("m1", "a", 1.25, 2.5)],
      obstacles: [],
      spec: { width_mm: 1134, height_mm: 1762 },
      title: "t",
    });
    const rect = d.items.find((i) => i.kind === "rect" && i.moduleId === "m1");
    if (!rect || rect.kind !== "rect") throw new Error("rect attendu");
    const local = localPointFromPlan(d, "a", rect.x + rect.w / 2, rect.y + rect.h / 2)!;
    expect(local.u).toBeCloseTo(1.25, 9);
    expect(local.v).toBeCloseTo(2.5, 9);
  });
});

/* ------------------------------ 6. Logo ---------------------------------- */

const PROJECT = "https://abc.supabase.co";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]);

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(ch);
      c.close();
    },
  });
}

describe("P1.1 — logo PDF durci", () => {
  const good = `${PROJECT}/storage/v1/object/public/logos/a.png`;

  test("origine : uniquement le stockage du projet (hôte exact)", () => {
    expect(isProjectStorageUrl(good, PROJECT)).toBe(true);
    expect(
      isProjectStorageUrl(`https://abc.supabase.co.evil.com/storage/v1/object/x.png`, PROJECT),
    ).toBe(false);
    expect(isProjectStorageUrl(`https://evil.com/storage/v1/object/x.png`, PROJECT)).toBe(false);
    expect(
      isProjectStorageUrl(`https://user:pw@abc.supabase.co/storage/v1/object/x.png`, PROJECT),
    ).toBe(false);
    expect(isProjectStorageUrl(`http://abc.supabase.co/storage/v1/object/x.png`, PROJECT)).toBe(
      false,
    );
    expect(isProjectStorageUrl(`${PROJECT}/rest/v1/companies`, PROJECT)).toBe(false);
    expect(isProjectStorageUrl(good, null)).toBe(false);
    expect(isProjectStorageUrl("pas une url", PROJECT)).toBe(false);
  });

  test("signature binaire : PNG/JPEG acceptés, PDF/texte refusés", () => {
    expect(sniffLogoType(PNG)).toBe("png");
    expect(sniffLogoType(JPG)).toBe("jpg");
    expect(sniffLogoType(new TextEncoder().encode("%PDF-1.7"))).toBeNull();
    expect(sniffLogoType(new TextEncoder().encode("<svg></svg>"))).toBeNull();
  });

  test("Content-Length : >2 Mio ou invalide refusé", () => {
    expect(contentLengthAcceptable(null)).toBe(true);
    expect(contentLengthAcceptable(String(PDF_LOGO_MAX_BYTES))).toBe(true);
    expect(contentLengthAcceptable(String(PDF_LOGO_MAX_BYTES + 1))).toBe(false);
    expect(contentLengthAcceptable("abc")).toBe(false);
  });

  test("lecture bornée : flux >2 Mio sans Content-Length interrompu", async () => {
    const big = new Uint8Array(1024 * 1024);
    expect(await readBounded(streamOf([big, big, new Uint8Array(1)]))).toBeNull();
    expect((await readBounded(streamOf([PNG])))!.byteLength).toBe(PNG.byteLength);
  });

  test("fetch : origine étrangère => aucun appel", async () => {
    let calls = 0;
    const res = await fetchLogoSafely("https://evil.com/storage/v1/object/x.png", {
      projectUrl: PROJECT,
      fetchImpl: async () => {
        calls += 1;
        return new Response(PNG);
      },
    });
    expect(res).toBeNull();
    expect(calls).toBe(0);
  });

  test("fetch : redirection interdite et délai borné", async () => {
    let init: RequestInit | null = null;
    const res = await fetchLogoSafely(good, {
      projectUrl: PROJECT,
      fetchImpl: async (_u, i) => {
        init = i;
        return new Response(streamOf([PNG]), { headers: { "content-type": "image/png" } });
      },
    });
    expect(res?.type).toBe("png");
    expect(init!.redirect).toBe("error");
    expect(init!.signal).toBeInstanceOf(AbortSignal);
  });

  test("fetch : >2 Mio annoncé refusé ; faux type refusé ; erreur réseau => null", async () => {
    const tooBig = await fetchLogoSafely(good, {
      projectUrl: PROJECT,
      fetchImpl: async () =>
        new Response(streamOf([PNG]), { headers: { "content-length": String(3 * 1024 * 1024) } }),
    });
    expect(tooBig).toBeNull();
    const fakeMime = await fetchLogoSafely(good, {
      projectUrl: PROJECT,
      fetchImpl: async () =>
        new Response(streamOf([new TextEncoder().encode("<html>")]), {
          headers: { "content-type": "image/png" },
        }),
    });
    expect(fakeMime).toBeNull();
    const failing = await fetchLogoSafely(good, {
      projectUrl: PROJECT,
      fetchImpl: async () => {
        throw new TypeError("redirect");
      },
    });
    expect(failing).toBeNull();
  });
});

/* --------------------------- 7. Abonnement ------------------------------- */

describe("P1.1 — abonnement utilisable avant écriture", () => {
  test("abonnement inutilisable => refus avant génération et écriture", async () => {
    const calls: string[] = [];
    await expect(
      runSolarExport({
        assertMember: async () => {
          calls.push("member");
        },
        assertSubscription: async () => {
          calls.push("subscription");
          throw new Error("SUBSCRIPTION_REQUIRED:expired");
        },
        build: async () => {
          calls.push("build");
          return new Uint8Array();
        },
        upload: async () => {
          calls.push("upload");
          return "ok";
        },
      }),
    ).rejects.toThrow("SUBSCRIPTION_REQUIRED");
    expect(calls).toEqual(["member", "subscription"]);
  });

  test("non-membre => refus avant tout", async () => {
    const calls: string[] = [];
    await expect(
      runSolarExport({
        assertMember: async () => {
          throw new Error("forbidden");
        },
        assertSubscription: async () => {
          calls.push("subscription");
        },
        build: async () => new Uint8Array(),
        upload: async () => {
          calls.push("upload");
        },
      }),
    ).rejects.toThrow("forbidden");
    expect(calls).toEqual([]);
  });

  test("ordre nominal et câblage serveur réel", async () => {
    const calls: string[] = [];
    const out = await runSolarExport({
      assertMember: async () => void calls.push("member"),
      assertSubscription: async () => void calls.push("subscription"),
      build: async () => {
        calls.push("build");
        return new Uint8Array([1]);
      },
      upload: async (b) => {
        calls.push("upload");
        return b.byteLength;
      },
    });
    expect(out).toBe(1);
    expect(calls).toEqual(["member", "subscription", "build", "upload"]);
    const src = readFileSync("src/lib/solar-export.functions.ts", "utf8");
    expect(src).toContain("assertSubscriptionUsable(data.companyId, userId)");
    expect(src).toContain("runSolarExport(");
    expect(src).toContain('hasPlanFeature(data.companyId, "branding")');
    expect(src).not.toContain("res.arrayBuffer()");
  });
});

/* ------------------- P1.2 — puissance ambiguë si champs dupliqués -------- */

describe("P1.2 — 2 champs sur le même pan : puissance partielle et alerte", () => {
  function duplicatedArrays() {
    const base = twoArrays();
    return {
      ...base,
      planes: [plane("p1", "a", "Pan A")],
      modules: [mod("m1", "a", 1, 1), mod("m2", "a", 2.5, 1)],
      arrays: [{ ...base.arrays[0]! }, { ...base.arrays[1]!, roof_plane_id: "p1" }],
    };
  }

  test("warning + power_complete=false + status=alerte", () => {
    const r = resultsFromModel(duplicatedArrays());
    expect(r.warnings.some((w) => w.code === "plusieurs_champs_meme_pan")).toBe(true);
    expect(r.global.power_complete).toBe(false);
    expect(r.global.status).toBe("alerte");
  });

  test("PDF client et technique : pas de « Puissance installée » sans réserve", () => {
    const r = resultsFromModel(duplicatedArrays());
    for (const v of ["client", "technique"] as const) {
      const s = JSON.stringify(buildSolarPdfSections(r, v, META));
      expect(s).toContain("Puissance connue");
      expect(s).toContain("valeur partielle");
      expect(s).not.toContain("Puissance installée");
    }
  });

  test("cas sain inchangé : 2 pans / 2 champs distincts restent complets", () => {
    const r = resultsFromModel(twoArrays());
    expect(r.global.power_complete).toBe(true);
    expect(r.global.status).toBe("ok");
    const s = JSON.stringify(buildSolarPdfSections(r, "client", META));
    expect(s).toContain("Puissance installée");
  });
});

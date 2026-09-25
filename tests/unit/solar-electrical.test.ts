import { describe, expect, test as it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import {
  addEmptyGroup,
  admissibleRange,
  assertPersistedLayoutHash,
  impWorst,
  iscWorst,
  missingModuleFields,
  assertGroupsContract,
  designSignature,
  electricalErrorMessage,
  evaluateDesign,
  impHot,
  iscHot,
  moduleElectricalFromRow,
  plausibleCoeff,
  vmpCold,
  historyInit,
  historyPush,
  historyRedo,
  historyUndo,
  moveModules,
  proposeWiring,
  rebalanceMppt,
  removeEmptyGroup,
  splitLengths,
  STALE_LAYOUT_MESSAGE,
  validateTemperatures,
  vmpHot,
  vocCold,
  type DesignTemperatures,
  type ElecGroup,
  type ElecModule,
  type InverterSpec,
  type ModuleElectrical,
  type StoredElectricalDesign,
} from "@/lib/solar-electrical";
import { electricalPdfSections } from "@/lib/solar-electrical/report";
import { buildSolarPdfSections } from "@/lib/solar/pdf-doc";
import { resultsFromModel } from "@/lib/solar/report-from-model";

const T: DesignTemperatures = { tmin_c: -10, tmax_c: 70, source: "test" };

const PANEL: ModuleElectrical = {
  key: "p|r",
  variant_id: "p",
  revision_id: "r",
  manufacturer: "M",
  model: "X",
  power_wc: 400,
  voc_v: 40,
  vmp_v: 33,
  isc_a: 10,
  imp_a: 9.5,
  tc_voc_pct_per_c: -0.3,
  tc_isc_pct_per_c: 0.05,
  tc_pmax_pct_per_c: -0.35,
  tc_vmp_pct_per_c: -0.4,
  tc_imp_pct_per_c: 0.05,
  max_system_voltage_v: 1000,
  electrical_source: "revision",
};
const PANEL_B: ModuleElectrical = { ...PANEL, key: "q|r", variant_id: "q", power_wc: 500 };

const INV: InverterSpec = {
  inverter_id: "i",
  revision_id: "ir",
  manufacturer: "Test",
  series: null,
  model: "T5",
  kind: "string",
  source_type: "manuel",
  provenance: "fiche test",
  phase: "mono",
  ac_power_w: 5000,
  mppt_count: 2,
  inputs_per_mppt: 2,
  vdc_max_v: 600,
  mppt_vmin_v: 120,
  mppt_vmax_v: 500,
  start_voltage_v: null,
  imax_mppt_a: 20,
  imax_input_a: 13,
  isc_max_mppt_a: 25,
  dc_power_max_w: null,
  dc_ac_ratio_max: 1.5,
  micro_inputs: null,
  micro_input_vmax_v: null,
  micro_input_imax_a: null,
  micro_input_isc_max_a: null,
  micro_input_power_max_w: null,
  datasheet_url: null,
};
const MICRO: InverterSpec = {
  ...INV,
  kind: "micro",
  model: "µ2",
  ac_power_w: 700,
  mppt_count: null,
  inputs_per_mppt: null,
  vdc_max_v: null,
  mppt_vmin_v: 16,
  mppt_vmax_v: null,
  imax_mppt_a: null,
  imax_input_a: null,
  isc_max_mppt_a: null,
  dc_ac_ratio_max: null,
  micro_inputs: 2,
  micro_input_vmax_v: 60,
  micro_input_imax_a: 14,
  micro_input_isc_max_a: 20,
  micro_input_power_max_w: 500,
};

function mods(
  n: number,
  plane = "A",
  key: string | null = PANEL.key,
  orientation: "portrait" | "paysage" = "portrait",
  offset = 0,
): ElecModule[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i + offset).padStart(12, "0")}`,
    plane_key: plane,
    plane_name: `Pan ${plane}`,
    orientation,
    module_key: key,
    u: i % 10,
    v: Math.floor(i / 10),
  }));
}
const EL = { [PANEL.key]: PANEL, [PANEL_B.key]: PANEL_B };
const str = (id: string, ids: string[], mppt = 0, inv = 0): ElecGroup => ({
  id,
  kind: "string",
  label: id,
  inverter_index: inv,
  mppt_index: mppt,
  module_ids: ids,
});

describe("formules température", () => {
  it("Voc froid avec coefficient négatif augmente la tension", () => {
    expect(vocCold(PANEL, T)).toBeCloseTo(40 * (1 + (-0.3 / 100) * -35), 6);
    expect(vocCold(PANEL, T)!).toBeGreaterThan(40);
  });
  it("Vmp chaud diminue la tension", () => {
    expect(vmpHot(PANEL, T)).toBeCloseTo(33 * (1 + (-0.4 / 100) * 45), 6);
    expect(vmpHot(PANEL, T)!).toBeLessThan(33);
  });
  it("températures obligatoires avec source", () => {
    expect(validateTemperatures({ tmin_c: -10, tmax_c: 70, source: "" })).toMatch(/source/);
    expect(validateTemperatures({ tmax_c: 70, source: "x" })).toMatch(/minimale/);
    expect(validateTemperatures(T)).toBeNull();
  });
});

describe("contrôles string / MPPT", () => {
  it("limite Vdc max inclusive", () => {
    const vc = vocCold(PANEL, T)!;
    const inv = { ...INV, vdc_max_v: vc * 10, mppt_vmax_v: null };
    const m = mods(10);
    const ok = evaluateDesign({
      inverter: inv,
      modules: m,
      electrical: EL,
      temps: T,
      groups: [
        str(
          "s1",
          m.map((x) => x.id),
        ),
      ],
    });
    expect(ok.checks.find((c) => c.code === "vdc_max")!.status).toBe("ok");
    const m11 = mods(11);
    const ko = evaluateDesign({
      inverter: inv,
      modules: m11,
      electrical: EL,
      temps: T,
      groups: [
        str(
          "s1",
          m11.map((x) => x.id),
        ),
      ],
    });
    expect(ko.checks.find((c) => c.code === "vdc_max")!.status).toBe("erreur");
    expect(ko.status).toBe("invalide");
  });
  it("limite MPPT min inclusive", () => {
    const vh = vmpHot(PANEL, T)!;
    const inv = { ...INV, mppt_vmin_v: vh * 5 };
    const m = mods(5);
    const e = evaluateDesign({
      inverter: inv,
      modules: m,
      electrical: EL,
      temps: T,
      groups: [
        str(
          "s1",
          m.map((x) => x.id),
        ),
      ],
    });
    expect(e.checks.find((c) => c.code === "mppt_min")!.status).toBe("ok");
    const m4 = mods(4);
    const e4 = evaluateDesign({
      inverter: inv,
      modules: m4,
      electrical: EL,
      temps: T,
      groups: [
        str(
          "s1",
          m4.map((x) => x.id),
        ),
      ],
    });
    expect(e4.checks.find((c) => c.code === "mppt_min")!.status).toBe("erreur");
  });
  it("courants parallèles : somme Imp et Isc", () => {
    const m = mods(16);
    const g = [
      str(
        "s1",
        m.slice(0, 8).map((x) => x.id),
      ),
      str(
        "s2",
        m.slice(8).map((x) => x.id),
      ),
    ];
    const e = evaluateDesign({ inverter: INV, modules: m, electrical: EL, temps: T, groups: g });
    // Sommes à Tmax (70 °C, αIsc +0,05 %/°C) : courants majorés de 2,25 %.
    const hot = 1 + (0.05 / 100) * (T.tmax_c - 25);
    expect(e.mppts[0]).toMatchObject({ strings: 2 });
    expect(e.mppts[0].imp_sum_a!).toBeCloseTo((2 * Math.round(9.5 * hot * 100)) / 100, 2);
    expect(e.mppts[0].isc_sum_a!).toBeCloseTo((2 * Math.round(10 * hot * 100)) / 100, 2);
    expect(e.checks.find((c) => c.code === "courant_mppt")!.status).toBe("ok");
    const e2 = evaluateDesign({
      inverter: { ...INV, imax_mppt_a: 18 },
      modules: m,
      electrical: EL,
      temps: T,
      groups: g,
    });
    expect(e2.checks.find((c) => c.code === "courant_mppt")!.status).toBe("erreur");
    const e3 = evaluateDesign({
      inverter: { ...INV, isc_max_mppt_a: 19.9 },
      modules: m,
      electrical: EL,
      temps: T,
      groups: g,
    });
    expect(e3.checks.find((c) => c.code === "isc_mppt")!.status).toBe("erreur");
  });
  it("longueurs inégales en parallèle refusées, égales acceptées", () => {
    const m = mods(15);
    const bad = evaluateDesign({
      inverter: INV,
      modules: m,
      electrical: EL,
      temps: T,
      groups: [
        str(
          "s1",
          m.slice(0, 8).map((x) => x.id),
        ),
        str(
          "s2",
          m.slice(8).map((x) => x.id),
        ),
      ],
    });
    expect(bad.checks.some((c) => c.code === "parallele_inegal")).toBe(true);
    const ok = evaluateDesign({
      inverter: INV,
      modules: m,
      electrical: EL,
      temps: T,
      groups: [
        str(
          "s1",
          m.slice(0, 8).map((x) => x.id),
        ),
        str(
          "s2",
          m.slice(8).map((x) => x.id),
          1,
        ),
      ],
    });
    expect(ok.checks.some((c) => c.code === "parallele_inegal")).toBe(false);
  });
  it("module non affecté signalé, doublon refusé", () => {
    const m = mods(9);
    const e = evaluateDesign({
      inverter: INV,
      modules: m,
      electrical: EL,
      temps: T,
      groups: [
        str(
          "s1",
          m.slice(0, 8).map((x) => x.id),
        ),
      ],
    });
    expect(e.unassigned_module_ids).toHaveLength(1);
    const d = evaluateDesign({
      inverter: INV,
      modules: m,
      electrical: EL,
      temps: T,
      groups: [
        str(
          "s1",
          m.slice(0, 8).map((x) => x.id),
        ),
        str("s2", [m[0].id], 1),
      ],
    });
    expect(d.checks.some((c) => c.code === "doublon")).toBe(true);
    expect(() =>
      assertGroupsContract([str("a", [m[0].id]), str("b", [m[0].id])], "string"),
    ).toThrow("duplicate_module_assignment");
  });
  it("ratio DC/AC calculé et limité par la valeur constructeur", () => {
    const m = mods(16);
    const g = [
      str(
        "s1",
        m.slice(0, 8).map((x) => x.id),
      ),
      str(
        "s2",
        m.slice(8).map((x) => x.id),
        1,
      ),
    ];
    const e = evaluateDesign({ inverter: INV, modules: m, electrical: EL, temps: T, groups: g });
    expect(e.dc_power_w).toBe(6400);
    expect(e.dc_ac_ratio).toBe(1.28);
    const e2 = evaluateDesign({
      inverter: { ...INV, dc_ac_ratio_max: 1.2 },
      modules: m,
      electrical: EL,
      temps: T,
      groups: g,
    });
    expect(e2.checks.find((c) => c.code === "ratio_dc_ac")!.status).toBe("erreur");
  });
  it("donnée absente => non vérifiable, jamais valide", () => {
    const m = mods(8);
    const noVdc = evaluateDesign({
      inverter: { ...INV, vdc_max_v: null },
      modules: m,
      electrical: EL,
      temps: T,
      groups: [
        str(
          "s1",
          m.map((x) => x.id),
        ),
      ],
    });
    expect(noVdc.checks.find((c) => c.code === "vdc_max")!.status).toBe("non_verifiable");
    expect(noVdc.status).toBe("non_verifiable");
    const el = { [PANEL.key]: { ...PANEL, tc_voc_pct_per_c: null } };
    const noCoeff = evaluateDesign({
      inverter: INV,
      modules: m,
      electrical: el,
      temps: T,
      groups: [
        str(
          "s1",
          m.map((x) => x.id),
        ),
      ],
    });
    expect(noCoeff.status).toBe("non_verifiable");
    expect(noCoeff.checks.some((c) => c.message.includes("coefficient Voc"))).toBe(true);
    const noSheet = evaluateDesign({
      inverter: INV,
      modules: mods(8, "A", null),
      electrical: EL,
      temps: T,
      groups: [
        str(
          "s1",
          mods(8, "A", null).map((x) => x.id),
        ),
      ],
    });
    expect(noSheet.status).not.toBe("valide");
  });
});

describe("auto-câblage", () => {
  it("plage admissible et découpage", () => {
    const r = admissibleRange(INV, PANEL, T);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const vc = vocCold(PANEL, T)!;
    expect(r.range.nmax).toBe(
      Math.min(Math.floor(600 / vc), Math.floor(500 / (33 * (1 + (-0.35 / 100) * -35)))),
    );
    expect(r.range.nmin).toBe(Math.ceil(120 / vmpHot(PANEL, T)!));
    expect(r.range.maxParallel).toBe(2);
    expect(splitLengths(20, { nmin: 5, nmax: 12, maxParallel: 2 }, true)).toEqual([10, 10]);
    expect(splitLengths(3, { nmin: 5, nmax: 12, maxParallel: 2 }, true)).toEqual([]);
  });
  it("données manquantes : proposition refusée avec champs listés", () => {
    const res = proposeWiring({
      inverter: { ...INV, mppt_vmin_v: null },
      modules: mods(10),
      electrical: EL,
      temps: T,
      layout_hash: "h",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.missing).toContain("tension MPPT min onduleur");
  });
  it("2 orientations → 2 MPPT distincts, chaque module une seule fois", () => {
    const m = [
      ...mods(10, "A", PANEL.key, "portrait"),
      ...mods(10, "B", PANEL.key, "paysage", 100),
    ];
    const res = proposeWiring({
      inverter: { ...INV, ac_power_w: 7000 },
      modules: m,
      electrical: EL,
      temps: T,
      layout_hash: "h",
      plane_order: ["A", "B"],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const rec = res.proposals[0];
    expect(rec.role).toBe("recommandee");
    const all = rec.groups.flatMap((g) => g.module_ids);
    expect(new Set(all).size).toBe(all.length);
    const mpptOf = (id: string) => rec.groups.find((g) => g.module_ids.includes(id))!.mppt_index;
    expect(mpptOf(m[0].id)).not.toBe(mpptOf(m[10].id));
    expect(rec.evaluation.status).toBe("valide");
    expect(rec.reasons.length).toBeGreaterThan(0);
    expect(res.proposals.length).toBeLessThanOrEqual(3);
    expect(new Set(res.proposals.map((p) => p.signature)).size).toBe(res.proposals.length);
  });
  it("déterministe", () => {
    const m = mods(23);
    const a = proposeWiring({
      inverter: INV,
      modules: m,
      electrical: EL,
      temps: T,
      layout_hash: "h",
    });
    const b = proposeWiring({
      inverter: INV,
      modules: [...m].reverse(),
      electrical: EL,
      temps: T,
      layout_hash: "h",
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it("références différentes jamais mises en parallèle", () => {
    const m = [...mods(10, "A", PANEL.key), ...mods(10, "A", PANEL_B.key, "portrait", 200)];
    const res = proposeWiring({
      inverter: INV,
      modules: m,
      electrical: EL,
      temps: T,
      layout_hash: "h",
    });
    expect(res.ok).toBe(true);
    if (res.ok)
      for (const p of res.proposals)
        expect(
          p.evaluation.checks.some(
            (c) => c.code === "parallele_refs" || c.code === "references_mixtes",
          ),
        ).toBe(false);
  });
  it("1000 modules en moins de 2 s", () => {
    const m = mods(1000);
    const t0 = performance.now();
    const res = proposeWiring({
      inverter: { ...INV, mppt_count: 4, inputs_per_mppt: 2 },
      modules: m,
      electrical: EL,
      temps: T,
      layout_hash: "h",
    });
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(res.ok).toBe(true);
    if (res.ok) {
      const all = res.proposals[0].groups.flatMap((g) => g.module_ids);
      expect(new Set(all).size).toBe(all.length);
      expect(res.proposals[0].evaluation.inverter_count).toBeGreaterThan(1);
    }
  });
});

describe("micro-onduleurs et hybride", () => {
  it("micro 1 entrée : un module par micro, AC totale", () => {
    const m = mods(5);
    const res = proposeWiring({
      inverter: { ...MICRO, micro_inputs: 1 },
      modules: m,
      electrical: EL,
      temps: T,
      layout_hash: "h",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const p = res.proposals[0];
    expect(p.groups.every((g) => g.kind === "micro" && g.module_ids.length === 1)).toBe(true);
    expect(p.evaluation.inverter_count).toBe(5);
    expect(p.evaluation.ac_power_w).toBe(3500);
  });
  it("micro 2 entrées : canaux par paires, surcharge refusée", () => {
    const m = mods(5);
    const res = proposeWiring({
      inverter: MICRO,
      modules: m,
      electrical: EL,
      temps: T,
      layout_hash: "h",
    });
    if (!res.ok) throw new Error("ko");
    expect(res.proposals[0].groups.map((g) => g.module_ids.length)).toEqual([2, 2, 1]);
    const over = evaluateDesign({
      inverter: MICRO,
      modules: m,
      electrical: EL,
      temps: T,
      groups: [
        {
          id: "m1",
          kind: "micro",
          label: "µ1",
          inverter_index: 0,
          mppt_index: null,
          module_ids: m.slice(0, 3).map((x) => x.id),
        },
      ],
    });
    expect(over.checks.find((c) => c.code === "micro_entrees")!.status).toBe("erreur");
    const hot = evaluateDesign({
      inverter: { ...MICRO, micro_input_vmax_v: 40 },
      modules: m,
      electrical: EL,
      temps: T,
      groups: [
        {
          id: "m1",
          kind: "micro",
          label: "µ1",
          inverter_index: 0,
          mppt_index: null,
          module_ids: [m[0].id],
        },
      ],
    });
    expect(hot.checks.find((c) => c.code === "micro_vmax")!.status).toBe("erreur");
  });
  it("hybride : partie PV traitée comme string", () => {
    const m = mods(16);
    const res = proposeWiring({
      inverter: { ...INV, kind: "hybride" },
      modules: m,
      electrical: EL,
      temps: T,
      layout_hash: "h",
    });
    if (!res.ok) throw new Error("ko");
    expect(res.proposals[0].groups.every((g) => g.kind === "string" && g.mppt_index != null)).toBe(
      true,
    );
    expect(res.proposals[0].evaluation.topology).toBe("hybride");
  });
});

describe("édition manuelle", () => {
  it("déplacer, créer/supprimer string vide, rééquilibrer, undo/redo", () => {
    const m = mods(10);
    let g: ElecGroup[] = [
      str(
        "s1",
        m.slice(0, 7).map((x) => x.id),
      ),
      str(
        "s2",
        m.slice(7).map((x) => x.id),
      ),
    ];
    g = moveModules(g, [m[0].id], "s2");
    expect(g[1].module_ids).toContain(m[0].id);
    expect(g[0].module_ids).not.toContain(m[0].id);
    g = addEmptyGroup(g, "string", 1);
    expect(g).toHaveLength(3);
    expect(removeEmptyGroup(g, "s1")).toHaveLength(3);
    expect(removeEmptyGroup(g, g[2].id)).toHaveLength(2);
    const r = rebalanceMppt(g, 0, 0);
    expect(r.map((x) => x.module_ids.length).slice(0, 2)).toEqual([5, 5]);
    let h = historyInit(1);
    for (let i = 2; i < 60; i += 1) h = historyPush(h, i);
    expect(h.past.length).toBe(50);
    h = historyUndo(h);
    expect(h.present).toBe(58);
    expect(historyRedo(h).present).toBe(59);
  });
  it("rouge si invalide après réaffectation", () => {
    const m = mods(16);
    let g = [
      str(
        "s1",
        m.slice(0, 8).map((x) => x.id),
      ),
      str(
        "s2",
        m.slice(8).map((x) => x.id),
      ),
    ];
    g = moveModules(g, [m[0].id], "s2");
    const e = evaluateDesign({ inverter: INV, modules: m, electrical: EL, temps: T, groups: g });
    expect(e.status).toBe("invalide");
  });
});

describe("signature et versions", () => {
  const base = {
    inverter: INV,
    electrical: EL,
    temps: T,
    layout_hash: "h1",
    groups: [str("s1", ["a"])],
  };
  it("signature change si layout_hash, révision onduleur, températures ou câblage changent", () => {
    const s = designSignature(base);
    expect(designSignature({ ...base, layout_hash: "h2" })).not.toBe(s);
    expect(designSignature({ ...base, inverter: { ...INV, revision_id: "ir2" } })).not.toBe(s);
    expect(designSignature({ ...base, temps: { ...T, tmin_c: -15 } })).not.toBe(s);
    expect(
      designSignature({ ...base, electrical: { [PANEL.key]: { ...PANEL, revision_id: "r2" } } }),
    ).not.toBe(s);
    expect(designSignature({ ...base, groups: [str("s1", ["b"])] })).not.toBe(s);
    expect(designSignature(base)).toBe(s);
  });
  it("messages utilisateur", () => {
    expect(electricalErrorMessage("stale_layout")).toBe(STALE_LAYOUT_MESSAGE);
    expect(STALE_LAYOUT_MESSAGE).toBe(
      "L'implantation a changé depuis le calcul électrique. Relancez le câblage.",
    );
    expect(electricalErrorMessage("forbidden")).toMatch(/Droits/);
    expect(electricalErrorMessage("subscription_unusable")).toMatch(/abonnement/);
  });
});

describe("contrat SQL P2-A (migration)", () => {
  const dir = "supabase/migrations";
  const sql = readdirSync(dir)
    .map((f: string) => readFileSync(`${dir}/${f}`, "utf8"))
    .join("\n");
  it("layout_version incrémenté par trigger sur panneaux et champs, empreinte couvrant positions", () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS layout_version/);
    expect(sql).toMatch(/solar_modules_layout_upd AFTER UPDATE ON public\.solar_modules_placed/);
    expect(sql).toMatch(/solar_arrays_layout_del AFTER DELETE ON public\.solar_arrays/);
    expect(sql).toMatch(/round\(m\.local_u_m::numeric, 6\), round\(m\.local_v_m::numeric, 6\)/);
  });
  it("RPC électrique : droits, abonnement, versions, doublons, transaction unique", () => {
    const fn = sql.slice(sql.indexOf("FUNCTION public.solar_apply_electrical_design"));
    expect(fn).toMatch(/can_manage_company\(_company_id, auth\.uid\(\)\)/);
    expect(fn).toMatch(/company_has_write_access\(_company_id\)/);
    expect(fn).toMatch(/RAISE EXCEPTION 'stale_layout'/);
    expect(fn).toMatch(
      /solar_layout_fingerprint\(_company_id, _model_id\) <> _expected_layout_hash/,
    );
    expect(fn).toMatch(/duplicate_module_assignment/);
    expect(fn).toMatch(/FOR UPDATE/);
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.solar_apply_electrical_design\([^)]*\) FROM PUBLIC, anon/,
    );
  });
  it("lecture membres uniquement, aucune écriture directe", () => {
    expect(sql).toMatch(
      /"designs member read" ON public\.solar_electrical_designs FOR SELECT TO authenticated USING \(is_company_member/,
    );
    expect(sql).not.toMatch(/ON public\.solar_electrical_designs FOR (INSERT|UPDATE|DELETE|ALL)/);
    expect(sql).toMatch(/GRANT SELECT ON public\.solar_electrical_designs/);
  });
  it("aucun onduleur pré-chargé inventé", () => {
    const inserts = sql.match(/INSERT INTO (public\.)?solar_inverters \(/g) ?? [];
    expect(inserts).toHaveLength(1);
    expect(sql).toMatch(/INSERT INTO solar_inverters \([^)]*\)\s*VALUES \(_company_id/);
  });
});

describe("résultats / PDF électriques", () => {
  const design: StoredElectricalDesign = {
    id: "d",
    topology: "string",
    status: "valide",
    inverter_snapshot: INV,
    inverter_count: 1,
    temp_min_c: -10,
    temp_max_c: 70,
    temp_source: "test",
    geometry_version: 3,
    layout_version: 7,
    layout_hash: "abc",
    engine_version: "p2a-1.0.0",
    variant_label: "Recommandée",
    summary: {
      dc_power_w: 6400,
      ac_power_w: 5000,
      dc_ac_ratio: 1.28,
      inverter_count: 1,
      mppts: [
        {
          inverter_index: 0,
          mppt_index: 0,
          strings: 2,
          voltage_v: 264,
          imp_sum_a: 19,
          isc_sum_a: 20,
        },
      ],
      unassigned: 0,
      strings: 2,
      formulas: [],
    },
    warnings: [],
    created_at: "2026-09-24T00:00:00Z",
    groups: [str("s1", ["a"]), str("s2", ["b"])],
  };
  it("PDF client : référence onduleur et puissances seulement", () => {
    const text = JSON.stringify(electricalPdfSections(design, "client", false));
    expect(text).toContain("Test");
    expect(text).toContain("5.00 kW");
    expect(text).not.toMatch(/MPPT|révision|moteur|abc/);
  });
  it("PDF technique : détail strings, MPPT, versions ; aucune production", () => {
    const secs = electricalPdfSections(design, "technique", false);
    const text = JSON.stringify(secs);
    expect(text).toContain("Strings");
    expect(text).toContain("moteur p2a-1.0.0");
    expect(text).not.toMatch(/kWh|ombrage|≤/);
  });
  it("conception obsolète : non reprise", () => {
    const text = JSON.stringify(electricalPdfSections(design, "technique", true));
    expect(text).toMatch(/obsolète/);
    expect(text).not.toContain("Strings");
  });
  it("sections intégrées au PDF avec mention hors schéma unifilaire", () => {
    const report = resultsFromModel({
      model: {
        name: "x",
        address: "1 rue A",
        postal_code: "34000",
        city: "Montpellier",
        geometry_version: 3,
        geometry_hash: null,
        updated_at: null,
        quality_level: "pre_etude",
      },
      planes: [],
      modules: [],
      obstacles: [],
      arrays: [],
    } as never);
    const secs = buildSolarPdfSections(
      report,
      "client",
      {
        reference: null,
        address: null,
        date: new Date(0),
        companyName: null,
        brandColor: "#000000",
      },
      electricalPdfSections(design, "client", false),
    );
    expect(JSON.stringify(secs)).toMatch(/schéma unifilaire officiel/);
    expect(JSON.stringify(secs)).toContain("Onduleur");
  });
});

describe("P2-A correctifs d'audit", () => {
  const TT: DesignTemperatures = { tmin_c: -10, tmax_c: 70, source: "test" };
  it("Vmp utilise uniquement le coefficient Vmp publié (aucune approximation γPmax)", () => {
    expect(vmpHot(PANEL, TT)).toBeCloseTo(33 * (1 + (-0.4 / 100) * 45), 6);
    expect(vmpCold(PANEL, TT)).toBeCloseTo(33 * (1 + (-0.4 / 100) * -35), 6);
    const noVmp = { ...PANEL, tc_vmp_pct_per_c: null };
    expect(vmpHot(noVmp, TT)).toBeNull();
    expect(vmpCold(noVmp, TT)).toBeNull();
  });
  it("Isc/Imp majorés à Tmax", () => {
    expect(iscHot(PANEL, TT)).toBeCloseTo(10 * (1 + (0.05 / 100) * 45), 6);
    expect(impHot(PANEL, TT)!).toBeGreaterThan(9.5);
  });
  it("coefficient hors plage (mV/°C ou signe inversé) => non vérifiable", () => {
    expect(plausibleCoeff("voc", -120)).toBeNull();
    expect(plausibleCoeff("voc", 0.3)).toBeNull();
    expect(plausibleCoeff("isc", 5)).toBeNull();
    expect(vocCold({ ...PANEL, tc_voc_pct_per_c: -120 }, TT)).toBeNull();
  });
  it("coefficient Isc absent => Vmp non calculable (pas de PASS implicite)", () => {
    expect(vmpHot({ ...PANEL, tc_isc_pct_per_c: null }, TT)).not.toBeNull();
    expect(iscHot({ ...PANEL, tc_isc_pct_per_c: null }, TT)).toBeNull();
  });
  it("snapshot électrique : révision posée prioritaire sur la fiche courante", () => {
    const variant = { id: "v1", voc_v: 50, vmp_v: 40, isc_a: 11, imp_a: 10, pmax_stc_w: 500 };
    const revision = {
      id: "r1",
      variant_id: "v1",
      pmax_stc_w: 475,
      electrical: { voc_v: 92.5, vmp_v: 78.5, isc_a: 6.45, imp_a: 6.07 },
    };
    const el = moduleElectricalFromRow(variant, "r1", null, revision);
    expect(el.voc_v).toBe(92.5);
    expect(el.power_wc).toBe(475);
    expect(el.electrical_source).toBe("revision");
    expect(el.key).toBe("v1|r1");
  });
  it("révision sans données électriques => aucune valeur catalogue courante, non vérifiable", () => {
    const variant = { id: "v1", voc_v: 50, pmax_stc_w: 500 };
    const el = moduleElectricalFromRow(variant, "r1", null, {
      id: "r1",
      variant_id: "v1",
      electrical: {},
    });
    expect(el.voc_v).toBeNull();
    expect(el.power_wc).toBeNull();
    expect(el.electrical_source).toBe("absente");
    const mods: ElecModule[] = [
      {
        id: "m1",
        plane_key: "p",
        plane_name: "P",
        orientation: "portrait",
        module_key: el.key,
        u: 0,
        v: 0,
      },
    ];
    const ev = evaluateDesign({
      inverter: { ...INV, kind: "micro", micro_inputs: 1 },
      modules: mods,
      electrical: { [el.key]: el },
      temps: TT,
      groups: [
        {
          id: "g",
          kind: "micro",
          label: "M1",
          inverter_index: 0,
          mppt_index: null,
          module_ids: ["m1"],
        },
      ],
    });
    expect(ev.checks.some((c) => c.code === "fiche_revision" && c.status === "non_verifiable")).toBe(
      true,
    );
  });
  it("révision d'une autre variante refusée : aucune donnée électrique", () => {
    const el = moduleElectricalFromRow({ id: "v1", voc_v: 50 }, "r9", null, {
      id: "r9",
      variant_id: "autre",
      electrical: { voc_v: 99 },
    });
    expect(el.voc_v).toBeNull();
  });
  it("contrôles de courant utilisent Imp/Isc chauds", () => {
    const ev = evaluateDesign({
      inverter: { ...INV, imax_input_a: 9.6 },
      modules: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => ({
        id: `m${i}`,
        plane_key: "p",
        plane_name: "P",
        orientation: "portrait" as const,
        module_key: PANEL.key,
        u: i,
        v: 0,
      })),
      electrical: { [PANEL.key]: PANEL },
      temps: TT,
      groups: [
        {
          id: "g",
          kind: "string",
          label: "S1",
          inverter_index: 0,
          mppt_index: 0,
          module_ids: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => `m${i}`),
        },
      ],
    });
    const c = ev.checks.find((x) => x.code === "courant_entree")!;
    expect(c.measured!).toBeGreaterThan(9.5);
    expect(c.status).toBe("erreur");
  });
  it("écriture électrique réservée au serveur (RPC non exécutable par le navigateur)", () => {
    const sql = readdirSync("supabase/migrations")
      .map((f: string) => readFileSync(`supabase/migrations/${f}`, "utf8"))
      .join("\n");
    expect(sql).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.solar_apply_electrical_design\([^)]*\) FROM authenticated/,
    );
    expect(sql).toMatch(
      /solar_apply_electrical_design_trusted\([^)]*\) FROM PUBLIC, anon, authenticated/,
    );
    expect(sql).toMatch(/NOT IN \('valide','avertissement','non_verifiable'\)/);
    const fn = readFileSync("src/lib/solar-electrical.functions.ts", "utf8");
    expect(fn).toMatch(
      /assertSolarManage[\s\S]*evaluateDesign[\s\S]*solar_apply_electrical_design_trusted/,
    );
    expect(fn).toMatch(/_actor: userId/);
  });
  it("empreinte d'implantation couvre révision, snapshot et activation", () => {
    const sql = readFileSync(
      "supabase/migrations/20260924211107_85606337-f086-4420-a504-aa85915f955c.sql",
      "utf8",
    );
    expect(sql).toMatch(/a\.module_revision_id/);
    expect(sql).toMatch(/a\.module_snapshot::text/);
    expect(sql).toMatch(/m\.orientation, m\.enabled/);
  });
  it("courant pire cas sur toute la plage : αIsc négatif => maximum à Tmin", () => {
    const neg = { ...PANEL, tc_isc_pct_per_c: -0.04, tc_imp_pct_per_c: -0.04 };
    expect(iscWorst(neg, TT)).toBeCloseTo(10 * (1 + (-0.04 / 100) * -35), 6);
    expect(impWorst(neg, TT)).toBeCloseTo(9.5 * (1 + (-0.04 / 100) * -35), 6);
    expect(iscWorst(PANEL, TT)).toBeCloseTo(10 * (1 + (0.05 / 100) * 45), 6);
    expect(iscWorst({ ...PANEL, tc_isc_pct_per_c: 0 }, TT)).toBeCloseTo(10, 9);
  });
  it("coefficient Imp absent => Imp pire cas non calculable (pas de substitution par αIsc)", () => {
    expect(impWorst({ ...PANEL, tc_imp_pct_per_c: null }, TT)).toBeNull();
    expect(missingModuleFields({ ...PANEL, tc_imp_pct_per_c: null })).toContain(
      "coefficient Imp (%/°C)",
    );
  });
  it("coefficient Vmp absent => MPPT min non vérifiable et aucune proposition auto", () => {
    const p = { ...PANEL, tc_vmp_pct_per_c: null };
    const m = [0, 1, 2, 3, 4].map((i) => ({
      id: `m${i}`,
      plane_key: "p",
      plane_name: "P",
      orientation: "portrait" as const,
      module_key: p.key,
      u: i,
      v: 0,
    }));
    const ev = evaluateDesign({
      inverter: INV,
      modules: m,
      electrical: { [p.key]: p },
      temps: TT,
      groups: [
        {
          id: "g",
          kind: "string",
          label: "S1",
          inverter_index: 0,
          mppt_index: 0,
          module_ids: m.map((x) => x.id),
        },
      ],
    });
    expect(ev.checks.find((c) => c.code === "mppt_min")?.status).toBe("non_verifiable");
    expect(ev.status).not.toBe("valide");
    const r = admissibleRange(INV, p, TT);
    expect(r.ok).toBe(false);
  });
  it("moteur sans approximation : pas de γPmax − αIsc dans le code", () => {
    const src = readFileSync("src/lib/solar-electrical/engine.ts", "utf8");
    expect(src).not.toMatch(/vmpCoeff|γPmax − αIsc|Math\.max\(0, c\)/);
    const map = readFileSync("src/lib/solar-electrical/mapping.ts", "utf8");
    expect(map).not.toMatch(/variante_courante|num\(variant\./);
  });
  it("empreinte d'implantation persistée dans le modèle et contrôlée à l'écriture", () => {
    const sql = readdirSync("supabase/migrations")
      .map((f: string) => readFileSync(`supabase/migrations/${f}`, "utf8"))
      .join("\n");
    expect(sql).toMatch(/ALTER TABLE public\.solar_models ADD COLUMN IF NOT EXISTS layout_hash text/);
    expect(sql).toMatch(/layout_hash = solar_layout_fingerprint\(s\.company_id, s\.id\)/);
    expect(sql).toMatch(/_lh IS DISTINCT FROM _expected_layout_hash/);
    expect(() => assertPersistedLayoutHash(null, "abc")).toThrow("stale_layout");
    expect(() => assertPersistedLayoutHash("x", "abc")).toThrow("stale_layout");
    expect(() => assertPersistedLayoutHash("abc", "abc")).not.toThrow();
    const srv = readFileSync("src/lib/solar-electrical.server.ts", "utf8");
    expect(srv).toMatch(/layout_hash"\)/);
    expect(srv).toMatch(/assertPersistedLayoutHash\(/);
  });
});

/**
 * Solar Studio P2-A — moteur électrique PUR et déterministe.
 *
 * Formules (températures en °C, coefficients en %/°C) :
 *   X(T) = X_STC × (1 + c/100 × (T − 25)), c = coefficient PUBLIÉ de X.
 *   Extrêmes évalués aux deux bornes de [Tmin, Tmax] (fonction affine).
 * Aucune approximation (ex. γVmp ≈ γPmax) ni repli sur la fiche catalogue courante :
 * une donnée absente => contrôle « non_verifiable ».
 */
import {
  ELECTRICAL_ENGINE_VERSION,
  type CheckStatus,
  type DesignEvaluation,
  type DesignStatus,
  type DesignTemperatures,
  type ElecCheck,
  type ElecGroup,
  type ElecModule,
  type GroupResult,
  type InverterSpec,
  type ModuleElectrical,
  type MpptResult,
} from "./types";

const r2 = (n: number) => Math.round(n * 100) / 100;

export function tempFactor(coeffPct: number | null, t: number): number | null {
  if (coeffPct == null || !Number.isFinite(coeffPct)) return null;
  return 1 + (coeffPct / 100) * (t - 25);
}

/**
 * Coefficients plausibles en %/°C pour du silicium cristallin / couches minces.
 * Une valeur hors plage (ex. saisie en mV/°C ou signe inversé) est rejetée :
 * le contrôle devient « non vérifiable » plutôt que faux.
 */
export function plausibleCoeff(
  kind: "voc" | "pmax" | "vmp" | "isc" | "imp",
  c: number | null,
): number | null {
  if (c == null || !Number.isFinite(c)) return null;
  if (kind === "isc" || kind === "imp") return c >= -0.05 && c <= 0.2 ? c : null;
  return c < 0 && c >= -1 ? c : null;
}

/**
 * Valeur extrême d'une grandeur linéaire en T sur [tmin, tmax] :
 * évaluée aux deux bornes (le pire cas d'une fonction affine est toujours à une borne).
 */
function extremeOverRange(
  base: number | null,
  coeff: number | null,
  t: DesignTemperatures,
  pick: "max" | "min",
): number | null {
  const a = tempFactor(coeff, t.tmin_c);
  const b = tempFactor(coeff, t.tmax_c);
  if (base == null || a == null || b == null) return null;
  return base * (pick === "max" ? Math.max(a, b) : Math.min(a, b));
}

/** Voc maximal sur la plage saisie (coefficient publié uniquement). */
export function vocCold(m: ModuleElectrical, t: DesignTemperatures): number | null {
  return extremeOverRange(m.voc_v, plausibleCoeff("voc", m.tc_voc_pct_per_c), t, "max");
}
/** Vmp minimal sur la plage — exige le coefficient Vmp publié (aucune approximation). */
export function vmpHot(m: ModuleElectrical, t: DesignTemperatures): number | null {
  return extremeOverRange(m.vmp_v, plausibleCoeff("vmp", m.tc_vmp_pct_per_c), t, "min");
}
/** Vmp maximal sur la plage — exige le coefficient Vmp publié. */
export function vmpCold(m: ModuleElectrical, t: DesignTemperatures): number | null {
  return extremeOverRange(m.vmp_v, plausibleCoeff("vmp", m.tc_vmp_pct_per_c), t, "max");
}
/** Isc pire cas (maximum) sur [tmin, tmax], quel que soit le signe de αIsc. */
export function iscWorst(m: ModuleElectrical, t: DesignTemperatures): number | null {
  return extremeOverRange(m.isc_a, plausibleCoeff("isc", m.tc_isc_pct_per_c), t, "max");
}
/** Imp pire cas (maximum) sur [tmin, tmax] — exige le coefficient Imp publié. */
export function impWorst(m: ModuleElectrical, t: DesignTemperatures): number | null {
  return extremeOverRange(m.imp_a, plausibleCoeff("imp", m.tc_imp_pct_per_c), t, "max");
}
/** @deprecated alias conservés pour compatibilité : pire cas sur la plage. */
export const iscHot = iscWorst;
export const impHot = impWorst;

/** Champs panneau manquants pour une validation stricte. */
export function missingModuleFields(m: ModuleElectrical): string[] {
  const out: string[] = [];
  if (m.electrical_source === "absente") out.push("données électriques de la révision posée");
  if (m.voc_v == null) out.push("Voc");
  if (m.vmp_v == null) out.push("Vmp");
  if (m.isc_a == null) out.push("Isc");
  if (m.imp_a == null) out.push("Imp");
  if (plausibleCoeff("voc", m.tc_voc_pct_per_c) == null) out.push("coefficient Voc (%/°C)");
  if (plausibleCoeff("vmp", m.tc_vmp_pct_per_c) == null) out.push("coefficient Vmp (%/°C)");
  if (plausibleCoeff("isc", m.tc_isc_pct_per_c) == null) out.push("coefficient Isc (%/°C)");
  if (plausibleCoeff("imp", m.tc_imp_pct_per_c) == null) out.push("coefficient Imp (%/°C)");
  if (m.power_wc == null) out.push("puissance STC");
  return out;
}

export function validateTemperatures(t: Partial<DesignTemperatures>): string | null {
  if (t.tmin_c == null || !Number.isFinite(t.tmin_c)) return "Température minimale requise.";
  if (t.tmax_c == null || !Number.isFinite(t.tmax_c)) return "Température maximale requise.";
  if (t.tmin_c < -50 || t.tmin_c > 30)
    return "Température minimale hors plage plausible (−50 à 30 °C).";
  if (t.tmax_c < 25 || t.tmax_c > 100)
    return "Température maximale hors plage plausible (25 à 100 °C).";
  if (t.tmin_c >= t.tmax_c) return "La température minimale doit être inférieure à la maximale.";
  if (!t.source || !t.source.trim()) return "Indiquez la source des températures.";
  return null;
}

/** Comparaison `measured ≤ limit` (inclusive) ; absent => non vérifiable. */
function le(
  code: string,
  scope: string,
  label: string,
  measured: number | null,
  limit: number | null,
  unit: string,
  failStatus: CheckStatus = "erreur",
): ElecCheck {
  if (measured == null || limit == null) {
    return {
      code,
      scope,
      label,
      status: "non_verifiable",
      measured: measured == null ? null : r2(measured),
      limit,
      unit,
      message: `${label} : non vérifiable (${measured == null ? "donnée panneau" : "donnée onduleur"} absente).`,
    };
  }
  const ok = measured <= limit + 1e-9;
  return {
    code,
    scope,
    label,
    status: ok ? "ok" : failStatus,
    measured: r2(measured),
    limit,
    unit,
    message: ok
      ? `${label} : ${r2(measured)} ${unit} ≤ ${limit} ${unit}.`
      : `${label} : ${r2(measured)} ${unit} dépasse ${limit} ${unit}.`,
  };
}
function ge(
  code: string,
  scope: string,
  label: string,
  measured: number | null,
  limit: number | null,
  unit: string,
  failStatus: CheckStatus = "erreur",
): ElecCheck {
  if (measured == null || limit == null) {
    return {
      code,
      scope,
      label,
      status: "non_verifiable",
      measured: measured == null ? null : r2(measured),
      limit,
      unit,
      message: `${label} : non vérifiable (${measured == null ? "donnée panneau" : "donnée onduleur"} absente).`,
    };
  }
  const ok = measured >= limit - 1e-9;
  return {
    code,
    scope,
    label,
    status: ok ? "ok" : failStatus,
    measured: r2(measured),
    limit,
    unit,
    message: ok
      ? `${label} : ${r2(measured)} ${unit} ≥ ${limit} ${unit}.`
      : `${label} : ${r2(measured)} ${unit} inférieur au minimum ${limit} ${unit}.`,
  };
}
function fail(
  code: string,
  scope: string,
  label: string,
  message: string,
  status: CheckStatus = "erreur",
): ElecCheck {
  return { code, scope, label, status, measured: null, limit: null, unit: "", message };
}

export function aggregateStatus(checks: ElecCheck[]): DesignStatus {
  if (checks.some((c) => c.status === "erreur")) return "invalide";
  if (checks.some((c) => c.status === "non_verifiable")) return "non_verifiable";
  if (checks.some((c) => c.status === "avertissement")) return "avertissement";
  return "valide";
}

export interface EvaluateInput {
  inverter: InverterSpec;
  modules: ElecModule[];
  electrical: Record<string, ModuleElectrical>;
  temps: DesignTemperatures;
  groups: ElecGroup[];
}

export function evaluateDesign(input: EvaluateInput): DesignEvaluation {
  const { inverter: inv, modules, electrical, temps, groups } = input;
  const checks: ElecCheck[] = [];
  const byId = new Map(modules.map((m) => [m.id, m]));
  const seen = new Set<string>();
  const groupResults: GroupResult[] = [];
  const topology = inv.kind;
  const formulas = [
    `Voc max = Voc STC × max(1 + βVoc/100 × (T − 25)) pour T ∈ [${temps.tmin_c} ; ${temps.tmax_c}] °C`,
    `Vmp min/max = Vmp STC × (1 + βVmp/100 × (T − 25)) aux bornes — coefficient Vmp publié obligatoire, sinon non vérifiable`,
    `Isc/Imp pire cas = valeur STC × max(1 + α/100 × (T − 25)) aux deux bornes de la plage — coefficient publié obligatoire (αIsc pour Isc, αImp pour Imp)`,
    `Coefficients acceptés uniquement en %/°C dans une plage plausible ; hors plage => non vérifiable`,
    `Températures : Tmin ${temps.tmin_c} °C / Tmax ${temps.tmax_c} °C — source : ${temps.source}`,
  ];

  const tErr = validateTemperatures(temps);
  if (tErr) checks.push(fail("temperatures", "Projet", "Températures", tErr));

  for (const g of groups) {
    const scope = g.label;
    let key: string | null | undefined;
    let mixed = false;
    let missingModule = false;
    for (const id of g.module_ids) {
      if (seen.has(id)) {
        checks.push(
          fail("doublon", scope, "Affectation", `Panneau affecté deux fois (${id.slice(0, 8)}).`),
        );
        continue;
      }
      seen.add(id);
      const m = byId.get(id);
      if (!m) {
        missingModule = true;
        continue;
      }
      if (key === undefined) key = m.module_key;
      else if (key !== m.module_key) mixed = true;
    }
    if (missingModule)
      checks.push(
        fail(
          "module_inconnu",
          scope,
          "Affectation",
          "Panneau absent de l'implantation enregistrée.",
        ),
      );
    if (mixed)
      checks.push(
        fail(
          "references_mixtes",
          scope,
          "Références",
          "Références de panneaux différentes dans un même groupe.",
        ),
      );

    const n = g.module_ids.length;
    const el = key ? (electrical[key] ?? null) : null;
    if (n > 0 && !el) {
      checks.push(
        fail(
          "fiche_absente",
          scope,
          "Fiche panneau",
          "Aucune fiche électrique pour ce panneau : contrôles impossibles.",
          "non_verifiable",
        ),
      );
    } else if (n > 0 && el) {
      if (el.electrical_source === "absente")
        checks.push(
          fail(
            "fiche_revision",
            scope,
            "Fiche panneau",
            "La révision posée ne contient pas de données électriques : contrôles non vérifiables (la fiche catalogue actuelle n'est jamais utilisée).",
            "non_verifiable",
          ),
        );
      const miss = missingModuleFields(el);
      if (miss.length)
        checks.push(
          fail(
            "donnees_panneau",
            scope,
            "Données panneau",
            `Données manquantes : ${miss.join(", ")}. Validation stricte impossible.`,
            "non_verifiable",
          ),
        );
    }
    const series = g.kind === "string" ? n : 1;
    const vc = el ? vocCold(el, temps) : null;
    const vh = el ? vmpHot(el, temps) : null;
    const vco = el ? vmpCold(el, temps) : null;
    const ih = el ? iscWorst(el, temps) : null;
    const jh = el ? impWorst(el, temps) : null;
    groupResults.push({
      group_id: g.id,
      module_count: n,
      module_key: key ?? null,
      voc_stc_v: el?.voc_v != null ? r2(el.voc_v * series) : null,
      vmp_stc_v: el?.vmp_v != null ? r2(el.vmp_v * series) : null,
      voc_cold_v: vc != null ? r2(vc * series) : null,
      vmp_hot_v: vh != null ? r2(vh * series) : null,
      vmp_cold_v: vco != null ? r2(vco * series) : null,
      isc_a: el?.isc_a ?? null,
      imp_a: el?.imp_a ?? null,
      isc_hot_a: ih != null ? r2(ih) : null,
      imp_hot_a: jh != null ? r2(jh) : null,
      power_dc_w: el?.power_wc != null ? el.power_wc * n : null,
    });

    if (n === 0) {
      checks.push(
        fail(
          "groupe_vide",
          scope,
          "Groupe",
          "Groupe vide : il ne sera pas enregistré tant qu'il est vide.",
          "avertissement",
        ),
      );
      continue;
    }

    if (g.kind === "micro") {
      checks.push(
        le("micro_entrees", scope, "Panneaux par micro-onduleur", n, inv.micro_inputs, "entrée(s)"),
      );
      checks.push(le("micro_vmax", scope, "Voc froid par entrée", vc, inv.micro_input_vmax_v, "V"));
      checks.push(
        le(
          "micro_isc",
          scope,
          "Isc pire cas par entrée",
          ih,
          inv.micro_input_isc_max_a ?? inv.micro_input_imax_a,
          "A",
        ),
      );
      if (inv.micro_input_power_max_w != null) {
        checks.push(
          le(
            "micro_puissance",
            scope,
            "Puissance par entrée",
            el?.power_wc ?? null,
            inv.micro_input_power_max_w,
            "W",
            "avertissement",
          ),
        );
      }
      if (inv.inputs_per_mppt != null || inv.mppt_vmin_v != null) {
        checks.push(
          ge(
            "micro_vmin",
            scope,
            "Vmp min par entrée",
            vh,
            inv.mppt_vmin_v,
            "V",
            "avertissement",
          ),
        );
      }
    } else {
      checks.push(
        le(
          "vdc_max",
          scope,
          "Voc froid string ≤ Vdc max onduleur",
          vc != null ? vc * n : null,
          inv.vdc_max_v,
          "V",
        ),
      );
      checks.push(
        le(
          "v_systeme_module",
          scope,
          "Voc froid string ≤ tension système panneau",
          vc != null ? vc * n : null,
          el?.max_system_voltage_v ?? null,
          "V",
        ),
      );
      checks.push(
        ge(
          "mppt_min",
          scope,
          "Vmp min ≥ MPPT min",
          vh != null ? vh * n : null,
          inv.mppt_vmin_v,
          "V",
        ),
      );
      checks.push(
        le(
          "mppt_max",
          scope,
          "Vmp froid ≤ MPPT max",
          vco != null ? vco * n : null,
          inv.mppt_vmax_v,
          "V",
          "avertissement",
        ),
      );
      if (inv.start_voltage_v != null) {
        checks.push(
          ge(
            "demarrage",
            scope,
            "Vmp min ≥ tension de démarrage",
            vh != null ? vh * n : null,
            inv.start_voltage_v,
            "V",
            "avertissement",
          ),
        );
      }
      checks.push(
        le(
          "courant_entree",
          scope,
          "Imp pire cas ≤ courant max par entrée",
          jh,
          inv.imax_input_a ?? inv.imax_mppt_a,
          "A",
        ),
      );
      if (g.mppt_index == null || g.mppt_index < 0) {
        checks.push(fail("mppt_absent", scope, "MPPT", "String non rattachée à un MPPT."));
      } else if (inv.mppt_count == null) {
        checks.push(
          fail(
            "mppt_count",
            scope,
            "MPPT",
            "Nombre de MPPT non publié : non vérifiable.",
            "non_verifiable",
          ),
        );
      } else if (g.mppt_index >= inv.mppt_count) {
        checks.push(
          fail(
            "mppt_count",
            scope,
            "MPPT",
            `MPPT ${g.mppt_index + 1} inexistant (l'onduleur en a ${inv.mppt_count}).`,
          ),
        );
      }
    }
  }

  // Agrégation MPPT
  const mppts: MpptResult[] = [];
  if (topology !== "micro") {
    const byMppt = new Map<string, ElecGroup[]>();
    for (const g of groups) {
      if (g.kind !== "string" || g.mppt_index == null || g.module_ids.length === 0) continue;
      const k = `${g.inverter_index}:${g.mppt_index}`;
      byMppt.set(k, [...(byMppt.get(k) ?? []), g]);
    }
    const keys = [...byMppt.keys()].sort((a, b) => {
      const [ai, am] = a.split(":").map(Number);
      const [bi, bm] = b.split(":").map(Number);
      return ai - bi || am - bm;
    });
    for (const k of keys) {
      const gs = byMppt.get(k)!;
      const [ii, mi] = k.split(":").map(Number);
      const scope = `Onduleur ${ii + 1} · MPPT ${mi + 1}`;
      const res = gs.map((g) => groupResults.find((r) => r.group_id === g.id)!);
      const lens = new Set(gs.map((g) => g.module_ids.length));
      const refs = new Set(res.map((r) => r.module_key));
      if (gs.length > 1 && lens.size > 1)
        checks.push(
          fail(
            "parallele_inegal",
            scope,
            "Strings en parallèle",
            "Strings de longueurs différentes en parallèle sur le même MPPT.",
          ),
        );
      if (gs.length > 1 && refs.size > 1)
        checks.push(
          fail(
            "parallele_refs",
            scope,
            "Strings en parallèle",
            "Références de panneaux différentes en parallèle sur le même MPPT.",
          ),
        );
      checks.push(
        le(
          "entrees_mppt",
          scope,
          "Strings par MPPT ≤ entrées",
          gs.length,
          inv.inputs_per_mppt,
          "string(s)",
        ),
      );
      const impSum = res.every((r) => r.imp_hot_a != null)
        ? res.reduce((s, r) => s + (r.imp_hot_a ?? 0), 0)
        : null;
      const iscSum = res.every((r) => r.isc_hot_a != null)
        ? res.reduce((s, r) => s + (r.isc_hot_a ?? 0), 0)
        : null;
      checks.push(
        le(
          "courant_mppt",
          scope,
          "Somme Imp pire cas ≤ courant max MPPT",
          impSum,
          inv.imax_mppt_a,
          "A",
        ),
      );
      checks.push(
        le("isc_mppt", scope, "Somme Isc pire cas ≤ Isc max MPPT", iscSum, inv.isc_max_mppt_a, "A"),
      );
      const p = res.every((r) => r.power_dc_w != null)
        ? res.reduce((s, r) => s + (r.power_dc_w ?? 0), 0)
        : null;
      mppts.push({
        inverter_index: ii,
        mppt_index: mi,
        strings: gs.length,
        voltage_v: res[0]?.vmp_stc_v ?? null,
        imp_sum_a: impSum != null ? r2(impSum) : null,
        isc_sum_a: iscSum != null ? r2(iscSum) : null,
        power_dc_w: p,
      });
    }
  }

  const nonEmpty = groups.filter((g) => g.module_ids.length > 0);
  const inverterCount =
    topology === "micro"
      ? nonEmpty.length
      : nonEmpty.length
        ? Math.max(...nonEmpty.map((g) => g.inverter_index)) + 1
        : 0;
  const unassigned = modules.map((m) => m.id).filter((id) => !seen.has(id));
  if (unassigned.length) {
    checks.push(
      fail(
        "non_affectes",
        "Projet",
        "Panneaux non affectés",
        `${unassigned.length} panneau(x) non raccordé(s).`,
        "avertissement",
      ),
    );
  }
  const dcKnown = groupResults.every((g) => g.module_count === 0 || g.power_dc_w != null);
  const dc = dcKnown ? groupResults.reduce((s, g) => s + (g.power_dc_w ?? 0), 0) : null;
  const ac = inv.ac_power_w != null ? inv.ac_power_w * inverterCount : null;
  const ratio = dc != null && ac != null && ac > 0 ? Math.round((dc / ac) * 1000) / 1000 : null;
  if (inverterCount > 0) {
    if (inv.ac_power_w == null)
      checks.push(
        fail(
          "ac_absent",
          "Onduleur",
          "Puissance AC",
          "Puissance AC non publiée : ratio DC/AC non vérifiable.",
          "non_verifiable",
        ),
      );
    if (inv.dc_ac_ratio_max != null)
      checks.push(
        le(
          "ratio_dc_ac",
          "Onduleur",
          "Ratio DC/AC ≤ limite constructeur",
          ratio,
          inv.dc_ac_ratio_max,
          "",
        ),
      );
    if (inv.dc_power_max_w != null && topology !== "micro") {
      checks.push(
        le(
          "dc_max",
          "Onduleur",
          "Puissance DC ≤ max constructeur",
          dc != null ? dc / inverterCount : null,
          inv.dc_power_max_w,
          "W",
        ),
      );
    }
  }
  if (nonEmpty.length === 0)
    checks.push(fail("aucun_groupe", "Projet", "Câblage", "Aucun panneau raccordé."));

  return {
    engine_version: ELECTRICAL_ENGINE_VERSION,
    topology,
    status: aggregateStatus(checks),
    inverter_count: inverterCount,
    groups: groupResults,
    mppts,
    checks,
    unassigned_module_ids: unassigned,
    dc_power_w: dc,
    ac_power_w: ac,
    dc_ac_ratio: ratio,
    formulas,
  };
}

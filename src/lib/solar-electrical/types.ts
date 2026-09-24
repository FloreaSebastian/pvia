/**
 * Solar Studio P2-A — types de la conception électrique.
 *
 * Module PUR. Aucune valeur par défaut : une donnée absente vaut `null`
 * et produit un contrôle « Non vérifiable », jamais un PASS implicite.
 */

export const ELECTRICAL_ENGINE_VERSION = "p2a-1.0.0";

export type InverterKind = "string" | "hybride" | "micro";
export type Phase = "mono" | "tri";

/** Données électriques d'un panneau, issues du snapshot/revision réellement posé. */
export interface ModuleElectrical {
  /** Clé stable variant|revision. */
  key: string;
  variant_id: string;
  revision_id: string | null;
  manufacturer: string | null;
  model: string | null;
  power_wc: number | null;
  voc_v: number | null;
  vmp_v: number | null;
  isc_a: number | null;
  imp_a: number | null;
  /** Coefficients en %/°C (unité catalogue). */
  tc_voc_pct_per_c: number | null;
  tc_isc_pct_per_c: number | null;
  tc_pmax_pct_per_c: number | null;
  max_system_voltage_v: number | null;
}

/** Fiche onduleur versionnée ; toute valeur non publiée reste null. */
export interface InverterSpec {
  inverter_id: string;
  revision_id: string;
  manufacturer: string;
  series: string | null;
  model: string;
  kind: InverterKind;
  source_type: string;
  provenance: string;
  phase: Phase | null;
  ac_power_w: number | null;
  mppt_count: number | null;
  inputs_per_mppt: number | null;
  vdc_max_v: number | null;
  mppt_vmin_v: number | null;
  mppt_vmax_v: number | null;
  start_voltage_v: number | null;
  imax_mppt_a: number | null;
  imax_input_a: number | null;
  isc_max_mppt_a: number | null;
  dc_power_max_w: number | null;
  dc_ac_ratio_max: number | null;
  micro_inputs: number | null;
  micro_input_vmax_v: number | null;
  micro_input_imax_a: number | null;
  micro_input_isc_max_a: number | null;
  micro_input_power_max_w: number | null;
  datasheet_url: string | null;
}

/** Températures de dimensionnement saisies par l'utilisateur, avec leur source. */
export interface DesignTemperatures {
  /** Température minimale (cellule, au lever du jour) en °C. */
  tmin_c: number;
  /** Température maximale de cellule en fonctionnement, en °C. */
  tmax_c: number;
  source: string;
}

export interface ElecModule {
  id: string;
  plane_key: string;
  plane_name: string;
  orientation: "portrait" | "paysage";
  /** Clé ModuleElectrical ; null si le pan n'a pas de fiche exploitable. */
  module_key: string | null;
  u: number;
  v: number;
}

/** Une string (onduleur string/hybride) ou un micro-onduleur (topologie micro). */
export interface ElecGroup {
  id: string;
  kind: "string" | "micro";
  label: string;
  inverter_index: number;
  /** Index MPPT (0-based) — strings uniquement. */
  mppt_index: number | null;
  module_ids: string[];
}

export type CheckStatus = "ok" | "avertissement" | "erreur" | "non_verifiable";

export interface ElecCheck {
  code: string;
  scope: string;
  label: string;
  status: CheckStatus;
  measured: number | null;
  limit: number | null;
  unit: string;
  message: string;
}

export interface GroupResult {
  group_id: string;
  module_count: number;
  module_key: string | null;
  voc_stc_v: number | null;
  vmp_stc_v: number | null;
  voc_cold_v: number | null;
  vmp_hot_v: number | null;
  vmp_cold_v: number | null;
  isc_a: number | null;
  imp_a: number | null;
  power_dc_w: number | null;
}

export interface MpptResult {
  inverter_index: number;
  mppt_index: number;
  strings: number;
  voltage_v: number | null;
  imp_sum_a: number | null;
  isc_sum_a: number | null;
  power_dc_w: number | null;
}

export type DesignStatus = "valide" | "avertissement" | "non_verifiable" | "invalide";

export interface DesignEvaluation {
  engine_version: string;
  topology: InverterKind;
  status: DesignStatus;
  inverter_count: number;
  groups: GroupResult[];
  mppts: MpptResult[];
  checks: ElecCheck[];
  unassigned_module_ids: string[];
  dc_power_w: number | null;
  ac_power_w: number | null;
  dc_ac_ratio: number | null;
  /** Formules et données utilisées (mode Expert). */
  formulas: string[];
}

export interface WiringProposal {
  id: string;
  role: "recommandee" | "simple" | "alternative";
  label: string;
  groups: ElecGroup[];
  evaluation: DesignEvaluation;
  reasons: string[];
  signature: string;
}

/** Synthèse enregistrée avec une conception électrique. */
export interface DesignSummary {
  dc_power_w: number | null;
  ac_power_w: number | null;
  dc_ac_ratio: number | null;
  inverter_count: number;
  mppts: MpptResult[];
  unassigned: number;
  strings: number;
  formulas: string[];
}

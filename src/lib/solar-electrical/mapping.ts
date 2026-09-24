/**
 * Solar Studio P2-A — conversions pures ligne base → types moteur, et contrôles de contrat.
 */
import type { ElecGroup, InverterKind, InverterSpec, ModuleElectrical, Phase } from "./types";

export const STALE_LAYOUT_MESSAGE =
  "L'implantation a changé depuis le calcul électrique. Relancez le câblage.";
export const SIGNATURE_MISMATCH_MESSAGE =
  "Le câblage envoyé ne correspond pas au calcul serveur. Relancez le câblage.";

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

export function moduleKey(variantId: string, revisionId: string | null): string {
  return `${variantId}|${revisionId ?? "-"}`;
}

export function moduleElectricalFromRow(
  variant: Record<string, unknown>,
  revisionId: string | null,
  snapshot?: Record<string, unknown> | null,
): ModuleElectrical {
  const id = String(variant.id);
  return {
    key: moduleKey(id, revisionId),
    variant_id: id,
    revision_id: revisionId,
    manufacturer: str(snapshot?.manufacturer),
    model: str(snapshot?.model),
    power_wc: num(snapshot?.power_wc) ?? num(variant.pmax_stc_w),
    voc_v: num(variant.voc_v),
    vmp_v: num(variant.vmp_v),
    isc_a: num(variant.isc_a),
    imp_a: num(variant.imp_a),
    tc_voc_pct_per_c: num(variant.temp_coeff_voc_pct_per_c),
    tc_isc_pct_per_c: num(variant.temp_coeff_isc_pct_per_c),
    tc_pmax_pct_per_c: num(variant.temp_coeff_pmax_pct_per_c),
    max_system_voltage_v: num(variant.max_system_voltage_v),
  };
}

export function inverterSpecFromRows(
  inv: Record<string, unknown>,
  rev: Record<string, unknown>,
): InverterSpec {
  const kind = (
    ["string", "hybride", "micro"].includes(String(inv.kind)) ? inv.kind : "string"
  ) as InverterKind;
  const phase = rev.phase === "mono" || rev.phase === "tri" ? (rev.phase as Phase) : null;
  return {
    inverter_id: String(inv.id),
    revision_id: String(rev.id),
    manufacturer: String(inv.manufacturer),
    series: str(inv.series),
    model: String(inv.model),
    kind,
    source_type: String(inv.source_type),
    provenance: String(rev.provenance ?? ""),
    phase,
    ac_power_w: num(rev.ac_power_w),
    mppt_count: num(rev.mppt_count),
    inputs_per_mppt: num(rev.inputs_per_mppt),
    vdc_max_v: num(rev.vdc_max_v),
    mppt_vmin_v: num(rev.mppt_vmin_v),
    mppt_vmax_v: num(rev.mppt_vmax_v),
    start_voltage_v: num(rev.start_voltage_v),
    imax_mppt_a: num(rev.imax_mppt_a),
    imax_input_a: num(rev.imax_input_a),
    isc_max_mppt_a: num(rev.isc_max_mppt_a),
    dc_power_max_w: num(rev.dc_power_max_w),
    dc_ac_ratio_max: num(rev.dc_ac_ratio_max),
    micro_inputs: num(rev.micro_inputs),
    micro_input_vmax_v: num(rev.micro_input_vmax_v),
    micro_input_imax_a: num(rev.micro_input_imax_a),
    micro_input_isc_max_a: num(rev.micro_input_isc_max_a),
    micro_input_power_max_w: num(rev.micro_input_power_max_w),
    datasheet_url: str(rev.datasheet_url),
  };
}

/** Contrôle structurel du câblage soumis (avant rejeu moteur). */
export function assertGroupsContract(groups: ElecGroup[], kind: InverterKind): void {
  if (!Array.isArray(groups) || groups.length > 500) throw new Error("invalid_groups");
  const seen = new Set<string>();
  for (const g of groups) {
    if (kind === "micro" ? g.kind !== "micro" : g.kind !== "string")
      throw new Error("topology_mismatch");
    for (const id of g.module_ids) {
      if (seen.has(id)) throw new Error("duplicate_module_assignment");
      seen.add(id);
    }
  }
}

export function electricalErrorMessage(raw: string): string {
  if (/stale_layout|model_not_found/.test(raw)) return STALE_LAYOUT_MESSAGE;
  if (/signature/.test(raw)) return SIGNATURE_MISMATCH_MESSAGE;
  if (/forbidden|Droits/.test(raw))
    return "Droits insuffisants pour modifier la conception électrique.";
  if (/subscription|abonnement/i.test(raw))
    return "Votre abonnement ne permet pas d'enregistrer de nouvelle conception.";
  if (/duplicate_module/.test(raw)) return "Un panneau est affecté deux fois.";
  if (/module_not_found/.test(raw)) return STALE_LAYOUT_MESSAGE;
  if (/topology_mismatch/.test(raw))
    return "Le type de câblage ne correspond pas à l'onduleur choisi.";
  if (/provenance_required/.test(raw)) return "Indiquez la provenance de la fiche onduleur.";
  if (/invalid_inverter/.test(raw))
    return "Fabricant, modèle et type d'onduleur sont obligatoires.";
  return "Opération impossible. Réessayez ou relancez le câblage.";
}

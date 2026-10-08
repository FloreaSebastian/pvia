/** Visites techniques — helpers purs du rapport PDF (testables sans serveur). */

export const VISIT_PDF_SCOPE_NOTE =
  "Ce rapport restitue les constats relevés lors de la visite technique. Il ne constitue ni une étude " +
  "de dimensionnement, ni une attestation de conformité réglementaire, ni un devis.";

/** WinAnsi ne couvre pas tout Unicode : remplacement propre des caractères hors plage. */
export function pdfSafe(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = Array.isArray(value) ? value.join(", ") : String(value);
  return s
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u00A0\u202F]/g, " ")
    .replace(/[^\t\n\r\u0020-\u00FF]/g, "");
}

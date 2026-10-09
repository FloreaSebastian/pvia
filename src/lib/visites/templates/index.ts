/** Catalogue des templates de visite technique. */
import type { VisitTemplate, VisitType } from "../types";
import { PHOTOVOLTAIQUE_TEMPLATE } from "./photovoltaique";
import { PAC_AIR_AIR_TEMPLATE } from "./pac-air-air";
import { PAC_AIR_EAU_TEMPLATE } from "./pac-air-eau";
import { composeBtpTemplate } from "./btp";

const BTP_BASE = composeBtpTemplate([]);

export const VISIT_TEMPLATES: Record<VisitType, VisitTemplate> = {
  photovoltaique: PHOTOVOLTAIQUE_TEMPLATE,
  pac_air_air: PAC_AIR_AIR_TEMPLATE,
  pac_air_eau: PAC_AIR_EAU_TEMPLATE,
  btp: BTP_BASE,
};

/** Template « type seul » (visites historiques). Pour une visite BTP, utiliser resolveVisitTemplate. */
export function getVisitTemplate(type: VisitType): VisitTemplate {
  return VISIT_TEMPLATES[type];
}

/**
 * Template effectif d'une visite : composé selon ses lots pour une visite BTP,
 * inchangé pour les dossiers historiques PV / PAC.
 */
export function resolveVisitTemplate(visit: { visit_type: string; lots?: readonly string[] | null }): VisitTemplate | null {
  if (visit.visit_type === "btp") return composeBtpTemplate(visit.lots ?? []);
  return isVisitType(visit.visit_type) ? VISIT_TEMPLATES[visit.visit_type] : null;
}

export function isVisitType(value: unknown): value is VisitType {
  return typeof value === "string" && value in VISIT_TEMPLATES;
}

/** Libellé court d'une visite pour les listes. */
export function visitLabel(visit: { visit_type: string; lots?: readonly string[] | null }): string {
  return resolveVisitTemplate(visit)?.label ?? visit.visit_type;
}

/** Types historiques (filtre de liste) + BTP. */
export const VISIT_TYPE_OPTIONS = (Object.values(VISIT_TEMPLATES) as VisitTemplate[]).map((t) => ({
  value: t.type,
  label: t.type === "btp" ? "BTP multi-lots" : t.label,
  tagline: t.tagline,
  chantierType: t.chantierType,
  stepCount: t.sections.length,
}));

export { PHOTOVOLTAIQUE_TEMPLATE, PAC_AIR_AIR_TEMPLATE, PAC_AIR_EAU_TEMPLATE };
export { composeBtpTemplate, BTP_LOT_OPTIONS, LOT_META, normalizeLots } from "./btp";

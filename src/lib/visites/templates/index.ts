/** Catalogue des templates de visite technique. */
import type { VisitTemplate, VisitType } from "../types";
import { PHOTOVOLTAIQUE_TEMPLATE } from "./photovoltaique";
import { PAC_AIR_AIR_TEMPLATE } from "./pac-air-air";
import { PAC_AIR_EAU_TEMPLATE } from "./pac-air-eau";

export const VISIT_TEMPLATES: Record<VisitType, VisitTemplate> = {
  photovoltaique: PHOTOVOLTAIQUE_TEMPLATE,
  pac_air_air: PAC_AIR_AIR_TEMPLATE,
  pac_air_eau: PAC_AIR_EAU_TEMPLATE,
};

export function getVisitTemplate(type: VisitType): VisitTemplate {
  return VISIT_TEMPLATES[type];
}

export function isVisitType(value: unknown): value is VisitType {
  return typeof value === "string" && value in VISIT_TEMPLATES;
}

export const VISIT_TYPE_OPTIONS = (Object.values(VISIT_TEMPLATES) as VisitTemplate[]).map((t) => ({
  value: t.type,
  label: t.label,
  tagline: t.tagline,
  chantierType: t.chantierType,
  stepCount: t.sections.length,
}));

export { PHOTOVOLTAIQUE_TEMPLATE, PAC_AIR_AIR_TEMPLATE, PAC_AIR_EAU_TEMPLATE };

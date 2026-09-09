/** Catalogue des templates de cahier des charges. */
import type { StudyTemplate, StudyType } from "../types";
import { STUDY_PV_TEMPLATE } from "./photovoltaique";
import { STUDY_PAC_AIR_AIR_TEMPLATE } from "./pac-air-air";
import { STUDY_PAC_AIR_EAU_TEMPLATE } from "./pac-air-eau";

export const STUDY_TEMPLATES: Record<StudyType, StudyTemplate> = {
  photovoltaique: STUDY_PV_TEMPLATE,
  pac_air_air: STUDY_PAC_AIR_AIR_TEMPLATE,
  pac_air_eau: STUDY_PAC_AIR_EAU_TEMPLATE,
};

export function getStudyTemplate(type: StudyType): StudyTemplate {
  return STUDY_TEMPLATES[type];
}

export function isStudyType(value: unknown): value is StudyType {
  return typeof value === "string" && value in STUDY_TEMPLATES;
}

export const STUDY_TYPE_OPTIONS = (Object.values(STUDY_TEMPLATES) as StudyTemplate[]).map((t) => ({
  value: t.type,
  label: t.label,
  tagline: t.tagline,
  chantierType: t.chantierType,
  stepCount: t.sections.length,
}));

export { STUDY_PV_TEMPLATE, STUDY_PAC_AIR_AIR_TEMPLATE, STUDY_PAC_AIR_EAU_TEMPLATE };

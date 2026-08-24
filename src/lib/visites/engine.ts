/**
 * Visites techniques — moteur de templates.
 *
 * Résout la conditionnalité (visibleIf), l'expansion des blocs répétables,
 * et calcule la complétude par étape (utilisée par la barre de progression,
 * l'écran de vérification et technical_visits.completion_percent).
 *
 * Module pur : aucune dépendance React ni serveur.
 */
import type {
  AnswerMap,
  AnswerValue,
  PhotoSlot,
  VisibleIf,
  VisitField,
  VisitSection,
  VisitTemplate,
} from "./types";

export const REPEAT_SEP = "__";

/** Clé effective d'un champ dans un bloc répétable (index 0-based). */
export function repeatKey(baseKey: string, index: number | null): string {
  return index === null ? baseKey : `${baseKey}${REPEAT_SEP}${index}`;
}

/** Retire le suffixe d'index d'une clé répétée. */
export function baseKeyOf(key: string): string {
  const i = key.lastIndexOf(REPEAT_SEP);
  if (i === -1) return key;
  const suffix = key.slice(i + REPEAT_SEP.length);
  return /^\d+$/.test(suffix) ? key.slice(0, i) : key;
}

function isFilled(v: AnswerValue | undefined): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "boolean") return true;
  if (typeof v === "number") return Number.isFinite(v);
  return false;
}

function sameValue(a: AnswerValue | undefined, b: string | number | boolean): boolean {
  if (a === undefined || a === null) return false;
  if (typeof b === "boolean") return a === b || String(a) === String(b);
  return String(a) === String(b);
}

/** Évalue un jeu de conditions (ET logique) pour un index de bloc répétable donné. */
export function matchesConditions(
  conditions: VisibleIf[] | undefined,
  answers: AnswerMap,
  index: number | null = null,
): boolean {
  if (!conditions || conditions.length === 0) return true;
  return conditions.every((c) => {
    // On tente d'abord la clé indexée (même bloc), puis la clé globale.
    const scoped = index === null ? undefined : answers[repeatKey(c.field, index)];
    const value = scoped !== undefined ? scoped : answers[c.field];
    if (c.truthy !== undefined) return c.truthy ? isFilled(value) && value !== false : !isFilled(value) || value === false;
    if (c.in) return c.in.some((v) => sameValue(value, v));
    if (c.equals !== undefined) return sameValue(value, c.equals);
    return isFilled(value);
  });
}

/** Nombre de blocs d'une étape répétable (borné par min/max du template). */
export function repeatCount(section: VisitSection, answers: AnswerMap): number {
  if (!section.repeat) return 1;
  const raw = answers[section.repeat.countField];
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
  const safe = Number.isFinite(n) ? n : section.repeat.min;
  return Math.max(section.repeat.min, Math.min(section.repeat.max, safe));
}

export interface ResolvedField extends VisitField {
  /** Clé effective en base (avec suffixe d'index si répété). */
  answerKey: string;
  repeatIndex: number | null;
}

export interface ResolvedPhotoSlot extends PhotoSlot {
  answerKey: string;
  repeatIndex: number | null;
}

export interface ResolvedBlock {
  /** null hors bloc répétable. */
  index: number | null;
  /** Ex. « Pan de toiture 2 ». */
  label: string | null;
  fields: ResolvedField[];
  photos: ResolvedPhotoSlot[];
}

export interface ResolvedSection {
  section: VisitSection;
  blocks: ResolvedBlock[];
}

/** Étapes visibles avec champs / photos déjà résolus (conditions + répétitions). */
export function resolveSections(template: VisitTemplate, answers: AnswerMap): ResolvedSection[] {
  const out: ResolvedSection[] = [];
  for (const section of template.sections) {
    if (!matchesConditions(section.visibleIf, answers)) continue;
    const count = section.repeat ? repeatCount(section, answers) : 1;
    const blocks: ResolvedBlock[] = [];
    for (let i = 0; i < count; i++) {
      const index = section.repeat ? i : null;
      blocks.push({
        index,
        label: section.repeat ? `${section.repeat.itemLabel} ${i + 1}` : null,
        fields: section.fields
          .filter((f) => matchesConditions(f.visibleIf, answers, index))
          .map((f) => ({ ...f, answerKey: repeatKey(f.key, index), repeatIndex: index })),
        photos: section.photos
          .filter((p) => matchesConditions(p.visibleIf, answers, index))
          .map((p) => ({ ...p, answerKey: repeatKey(p.key, index), repeatIndex: index })),
      });
    }
    out.push({ section, blocks });
  }
  return out;
}

export type SectionState = "complete" | "partial" | "empty";

export interface SectionProgress {
  key: string;
  title: string;
  short: string;
  kind: VisitSection["kind"];
  state: SectionState;
  requiredFields: number;
  filledRequiredFields: number;
  missingFieldLabels: string[];
  requiredPhotos: number;
  providedPhotos: number;
  missingPhotoLabels: string[];
  touched: boolean;
}

export interface ProgressInput {
  answers: AnswerMap;
  /** Clés de slots (answerKey) ayant au moins une photo. */
  photoSlots: Set<string>;
  /** Clés de slots explicitement marqués « impossible à photographier ». */
  skippedSlots: Set<string>;
  /** Nombre de contraintes saisies (l'étape Contraintes est facultative par nature). */
  constraintCount: number;
}

export interface VisitProgress {
  sections: SectionProgress[];
  percent: number;
  /** Vrai si toutes les étapes obligatoires sont complètes. */
  canComplete: boolean;
  missingCount: number;
}

/** Calcule la complétude de la visite. Source unique pour l'UI et le serveur. */
export function computeProgress(
  template: VisitTemplate,
  { answers, photoSlots, skippedSlots, constraintCount }: ProgressInput,
): VisitProgress {
  const resolved = resolveSections(template, answers);
  const sections: SectionProgress[] = [];
  let totalRequired = 0;
  let totalDone = 0;

  for (const { section, blocks } of resolved) {
    let requiredFields = 0;
    let filledRequiredFields = 0;
    let requiredPhotos = 0;
    let providedPhotos = 0;
    let touched = false;
    const missingFieldLabels: string[] = [];
    const missingPhotoLabels: string[] = [];

    for (const block of blocks) {
      const suffix = block.label ? ` (${block.label})` : "";
      for (const field of block.fields) {
        const filled = isFilled(answers[field.answerKey]);
        if (filled) touched = true;
        if (field.required) {
          requiredFields++;
          if (filled) filledRequiredFields++;
          else missingFieldLabels.push(`${field.label}${suffix}`);
        }
      }
      for (const slot of block.photos) {
        const done = photoSlots.has(slot.answerKey) || skippedSlots.has(slot.answerKey);
        if (photoSlots.has(slot.answerKey)) touched = true;
        if (slot.required) {
          requiredPhotos++;
          if (done) providedPhotos++;
          else missingPhotoLabels.push(`${slot.label}${suffix}`);
        }
      }
    }

    if (section.kind === "constraints" && constraintCount > 0) touched = true;

    const required = requiredFields + requiredPhotos;
    const done = filledRequiredFields + providedPhotos;
    totalRequired += required;
    totalDone += done;

    const state: SectionState =
      required === 0 ? (touched ? "complete" : "empty") : done === required ? "complete" : done > 0 || touched ? "partial" : "empty";

    sections.push({
      key: section.key,
      title: section.title,
      short: section.short,
      kind: section.kind ?? "form",
      state,
      requiredFields,
      filledRequiredFields,
      missingFieldLabels,
      requiredPhotos,
      providedPhotos,
      missingPhotoLabels,
      touched,
    });
  }

  const percent = totalRequired === 0 ? (sections.some((s) => s.touched) ? 100 : 0) : Math.round((totalDone / totalRequired) * 100);
  const missingCount = totalRequired - totalDone;

  return {
    sections,
    percent: Math.max(0, Math.min(100, percent)),
    canComplete: missingCount <= 0,
    missingCount: Math.max(0, missingCount),
  };
}

/** Étiquette lisible d'un champ (pour le rapport et l'écran de vérification). */
export function fieldLabelMap(template: VisitTemplate, answers: AnswerMap): Map<string, string> {
  const map = new Map<string, string>();
  for (const { section, blocks } of resolveSections(template, answers)) {
    for (const block of blocks) {
      for (const f of block.fields) {
        map.set(f.answerKey, block.label ? `${f.label} — ${block.label}` : f.label);
      }
      for (const p of block.photos) {
        map.set(p.answerKey, block.label ? `${p.label} — ${block.label}` : p.label);
      }
    }
    map.set(section.key, section.title);
  }
  return map;
}

/** Formate une valeur de réponse pour l'affichage (rapport, PDF, récap). */
export function formatAnswer(field: VisitField, value: AnswerValue | undefined): string {
  if (!isFilled(value)) return "—";
  if (field.type === "boolean") return value ? "Oui" : "Non";
  if (Array.isArray(value)) {
    return value
      .map((v) => field.options?.find((o) => o.value === v)?.label ?? v)
      .join(", ");
  }
  if (field.type === "select") {
    return field.options?.find((o) => String(o.value) === String(value))?.label ?? String(value);
  }
  const base = String(value);
  return field.unit ? `${base} ${field.unit}` : base;
}

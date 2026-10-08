/**
 * Visites techniques — validation sémantique des réponses, partagée client + serveur.
 *
 * Chaque réponse est contrôlée contre le modèle métier (PV / PAC) : clé connue,
 * étape correcte, type, options autorisées, bornes et format. Module pur.
 */
const REPEAT_SEP = "__";
import type { AnswerValue, VisitField, VisitSection, VisitTemplate } from "./types";

export interface FieldLookup {
  section: VisitSection;
  field: VisitField;
  repeatIndex: number | null;
}

/** Retrouve le champ du modèle correspondant à une clé de réponse (y compris blocs répétés). */
export function findTemplateField(template: VisitTemplate, answerKey: string): FieldLookup | null {
  let base = answerKey;
  let index: number | null = null;
  const i = answerKey.lastIndexOf(REPEAT_SEP);
  if (i !== -1) {
    const suffix = answerKey.slice(i + REPEAT_SEP.length);
    if (/^\d+$/.test(suffix)) {
      base = answerKey.slice(0, i);
      index = Number.parseInt(suffix, 10);
    }
  }
  for (const section of template.sections) {
    const field = section.fields.find((f) => f.key === base);
    if (!field) continue;
    if (section.repeat) {
      if (index === null || index < 0 || index >= section.repeat.max) return null;
    } else if (index !== null) {
      return null;
    }
    return { section, field, repeatIndex: index };
  }
  return null;
}

function fmt(n: number, unit?: string) {
  return `${String(n).replace(".", ",")}${unit ? ` ${unit}` : ""}`;
}

/**
 * Valide une valeur pour un champ. Renvoie un message lisible ou null si valide.
 * `null` / chaîne vide = effacement de la réponse, toujours accepté.
 */
export function validateFieldValue(field: VisitField, value: AnswerValue): string | null {
  if (value === null) return null;
  if (typeof value === "string" && value.trim() === "" && field.type !== "boolean") return null;
  const label = `« ${field.label} »`;
  switch (field.type) {
    case "text":
      if (typeof value !== "string") return `${label} : texte attendu.`;
      if (value.length > 500) return `${label} : 500 caractères maximum.`;
      return null;
    case "textarea":
      if (typeof value !== "string") return `${label} : texte attendu.`;
      if (value.length > 5000) return `${label} : 5000 caractères maximum.`;
      return null;
    case "number": {
      const n = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(",", ".")) : NaN;
      if (typeof value !== "number" || !Number.isFinite(n)) return `${label} : nombre attendu.`;
      if (field.min !== undefined && n < field.min) return `${label} : minimum ${fmt(field.min, field.unit)}.`;
      if (field.max !== undefined && n > field.max) return `${label} : maximum ${fmt(field.max, field.unit)}.`;
      if (field.step !== undefined && field.step >= 1 && !Number.isInteger(n)) return `${label} : nombre entier attendu.`;
      return null;
    }
    case "select":
      if (typeof value !== "string") return `${label} : choix invalide.`;
      if (field.options && !field.options.some((o) => o.value === value)) return `${label} : choix non proposé.`;
      return null;
    case "multiselect":
      if (!Array.isArray(value)) return `${label} : liste de choix attendue.`;
      if (new Set(value).size !== value.length) return `${label} : choix en double.`;
      if (field.options && value.some((v) => !field.options!.some((o) => o.value === v))) return `${label} : choix non proposé.`;
      return null;
    case "boolean":
      if (typeof value !== "boolean") return `${label} : Oui ou Non attendu.`;
      return null;
    case "date": {
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${label} : date au format JJ/MM/AAAA attendue.`;
      const d = new Date(`${value}T00:00:00Z`);
      if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) return `${label} : date invalide.`;
      const y = d.getUTCFullYear();
      if (y < 1800 || y > 2100) return `${label} : année hors plage.`;
      return null;
    }
    default:
      return `${label} : type de champ inconnu.`;
  }
}

/** Valeur non vide ET conforme : seule une telle valeur compte comme « renseignée ». */
export function isValidFilled(field: VisitField, value: AnswerValue | undefined): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string" && value.trim() === "") return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return validateFieldValue(field, value) === null;
}

export interface AnswerEntryInput {
  section_key: string;
  field_key: string;
  value: AnswerValue;
}

export interface AnswerValidationError {
  field_key: string;
  message: string;
}

/** Valide un lot de réponses contre le modèle : clé connue, étape, valeur. */
export function validateAnswerEntries(template: VisitTemplate, entries: AnswerEntryInput[]): AnswerValidationError[] {
  const errors: AnswerValidationError[] = [];
  for (const e of entries) {
    const hit = findTemplateField(template, e.field_key);
    if (!hit) {
      errors.push({ field_key: e.field_key, message: "Champ inconnu pour ce type de visite." });
      continue;
    }
    if (hit.section.key !== e.section_key) {
      errors.push({ field_key: e.field_key, message: `« ${hit.field.label} » n'appartient pas à cette étape.` });
      continue;
    }
    const msg = validateFieldValue(hit.field, e.value);
    if (msg) errors.push({ field_key: e.field_key, message: msg });
  }
  return errors;
}

/** Retrouve l'emplacement photo du modèle (y compris blocs répétés) et vérifie son étape. */
export function findTemplateSlot(
  template: VisitTemplate,
  sectionKey: string,
  slotKey: string,
): { section: VisitSection; slot: VisitSection["photos"][number]; repeatIndex: number | null } | null {
  let base = slotKey;
  let index: number | null = null;
  const i = slotKey.lastIndexOf(REPEAT_SEP);
  if (i !== -1) {
    const suffix = slotKey.slice(i + REPEAT_SEP.length);
    if (/^\d+$/.test(suffix)) {
      base = slotKey.slice(0, i);
      index = Number.parseInt(suffix, 10);
    }
  }
  const section = template.sections.find((s) => s.key === sectionKey);
  if (!section) return null;
  const slot = section.photos.find((p) => p.key === base);
  if (!slot) return null;
  if (section.repeat) {
    if (index === null || index < 0 || index >= section.repeat.max) return null;
  } else if (index !== null) return null;
  return { section, slot, repeatIndex: index };
}

/** Limites des fichiers photo acceptés. */
export const VISIT_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const VISIT_PHOTO_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
export const VISIT_PHOTO_EXT = /\.(jpe?g|png|webp)$/i;

/** Reconnaît la signature binaire JPEG / PNG / WebP (les 12 premiers octets suffisent). */
export function sniffImage(b: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

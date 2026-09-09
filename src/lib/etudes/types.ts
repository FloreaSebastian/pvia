/**
 * Cahiers des charges (pré-étude avant-vente) — types.
 *
 * Le catalogue de questions vit dans le code (src/lib/etudes/templates/*),
 * exactement comme pour les visites techniques : on réutilise le moteur de
 * templates existant (src/lib/visites/engine.ts) plutôt que d'en créer un second.
 */
import type { VisitSection } from "../visites/types";

export type StudyType = "photovoltaique" | "pac_air_air" | "pac_air_eau";

export const STUDY_TYPES: StudyType[] = ["photovoltaique", "pac_air_air", "pac_air_eau"];

export type StudyStatus =
  | "draft"
  | "in_progress"
  | "internal_review"
  | "completed"
  | "sent"
  | "accepted"
  | "refused"
  | "archived";

export type NoteVisibility = "internal" | "client";

export interface StudyTemplate {
  type: StudyType;
  label: string;
  tagline: string;
  /** Valeur reprise dans chantiers.type lors d'une conversion. */
  chantierType: string;
  sections: VisitSection[];
  photoCategories: string[];
  /** Catégories de documents administratifs attendus. */
  docCategories: string[];
}

export const STUDY_STATUS_META: Record<
  StudyStatus,
  { label: string; tone: "neutral" | "info" | "warn" | "success" | "muted" | "danger" }
> = {
  draft: { label: "Brouillon", tone: "neutral" },
  in_progress: { label: "En cours", tone: "info" },
  internal_review: { label: "À valider", tone: "warn" },
  completed: { label: "Validé", tone: "success" },
  sent: { label: "Envoyé au client", tone: "info" },
  accepted: { label: "Accepté", tone: "success" },
  refused: { label: "Refusé", tone: "danger" },
  archived: { label: "Archivé", tone: "muted" },
};

/** Statuts à partir desquels le contenu technique est figé. */
export const LOCKED_STUDY_STATUSES: StudyStatus[] = ["accepted", "refused", "archived"];

export const STUDY_DOC_CATEGORIES = [
  "Facture d'énergie",
  "Plan / cadastre",
  "Photo toiture",
  "Photo tableau électrique",
  "Photo compteur",
  "Devis existant",
  "Diagnostic / DPE",
  "Document administratif",
  "Autre",
] as const;

export interface EstimateItem {
  key: string;
  label: string;
  value: string;
  help?: string;
}

export interface StudyEstimate {
  /** Chiffre principal affiché en tête (ex. « 6 kWc »). */
  headline: { label: string; value: string } | null;
  items: EstimateItem[];
  /** Points de vigilance déduits des réponses. */
  warnings: string[];
  /** Données manquantes empêchant un calcul fiable. */
  missing: string[];
}

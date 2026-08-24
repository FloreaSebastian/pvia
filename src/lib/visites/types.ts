/**
 * Visites techniques — types du moteur de templates.
 *
 * Le catalogue des étapes / champs / photos vit dans le code (src/lib/visites/templates/*),
 * pas en base : versionnable, typé, aucune requête pour afficher un formulaire.
 * Les réponses sont stockées en clé/valeur dans technical_visit_answers.
 */

export type VisitType = "photovoltaique" | "pac_air_air" | "pac_air_eau";

export const VISIT_TYPES: VisitType[] = ["photovoltaique", "pac_air_air", "pac_air_eau"];

export type VisitStatus =
  | "a_planifier"
  | "planifiee"
  | "en_cours"
  | "a_completer"
  | "terminee"
  | "validee"
  | "archivee";

export type ConstraintLevel = "information" | "a_verifier" | "important" | "bloquant";

export type ConstraintCategory =
  | "acces"
  | "electricite"
  | "toiture"
  | "structure"
  | "hydraulique"
  | "frigorifique"
  | "securite"
  | "client"
  | "materiel"
  | "autre";

export type PhotoSkipReason =
  | "inaccessible"
  | "equipement_absent"
  | "client_absent"
  | "danger"
  | "autre";

export type AnswerValue = string | number | boolean | string[] | null;

export type AnswerMap = Record<string, AnswerValue>;

export type FieldType =
  | "text"
  | "textarea"
  | "number"
  | "select"
  | "multiselect"
  | "boolean"
  | "date";

/** Condition d'affichage : toutes les conditions d'un tableau doivent être vraies (ET). */
export interface VisibleIf {
  /** Clé du champ observé. Dans un bloc répétable, la clé est résolue sur le même index. */
  field: string;
  /** Égalité stricte (après normalisation string). */
  equals?: string | number | boolean;
  /** Valeur présente dans la liste. */
  in?: (string | number)[];
  /** Vrai si la valeur est renseignée / cochée. */
  truthy?: boolean;
}

export interface VisitField {
  key: string;
  label: string;
  type: FieldType;
  /** Unité affichée en suffixe (m, m², kW, °C...). */
  unit?: string;
  options?: { value: string; label: string }[];
  placeholder?: string;
  help?: string;
  required?: boolean;
  min?: number;
  max?: number;
  step?: number;
  /** Occupe toute la largeur sur desktop. */
  wide?: boolean;
  visibleIf?: VisibleIf[];
}

export interface PhotoSlot {
  key: string;
  label: string;
  /** Consigne de prise de vue affichée sur la carte photo. */
  instruction?: string;
  /** Catégorie de galerie / rapport. */
  category: string;
  required?: boolean;
  /** Autorise plusieurs photos pour ce slot. */
  multiple?: boolean;
  visibleIf?: VisibleIf[];
}

/** Bloc répétable : les clés des champs et slots sont suffixées `__<index>`. */
export interface RepeatConfig {
  /** Champ nombre qui pilote le nombre de blocs (peut appartenir à une autre étape). */
  countField: string;
  /** Libellé d'un bloc, ex. « Pan de toiture ». */
  itemLabel: string;
  min: number;
  max: number;
}

export interface VisitSection {
  key: string;
  /** Titre complet, ex. « Installation électrique ». */
  title: string;
  /** Titre court pour la barre de progression. */
  short: string;
  description?: string;
  fields: VisitField[];
  photos: PhotoSlot[];
  repeat?: RepeatConfig;
  visibleIf?: VisibleIf[];
  /** Étape « Contraintes & points de vigilance » (UI dédiée). */
  kind?: "form" | "constraints" | "review";
}

export interface VisitTemplate {
  type: VisitType;
  label: string;
  /** Valeur écrite dans chantiers.type lors de la création automatique. */
  chantierType: string;
  tagline: string;
  sections: VisitSection[];
  /** Ordre d'affichage des catégories dans la galerie et le rapport PDF. */
  photoCategories: string[];
}

export const VISIT_STATUS_META: Record<
  VisitStatus,
  { label: string; tone: "neutral" | "info" | "warn" | "success" | "muted" }
> = {
  a_planifier: { label: "À planifier", tone: "warn" },
  planifiee: { label: "Planifiée", tone: "info" },
  en_cours: { label: "En cours", tone: "info" },
  a_completer: { label: "À compléter", tone: "warn" },
  terminee: { label: "Terminée", tone: "success" },
  validee: { label: "Validée", tone: "success" },
  archivee: { label: "Archivée", tone: "muted" },
};

export const CONSTRAINT_LEVEL_META: Record<ConstraintLevel, { label: string; tone: string }> = {
  information: { label: "Information", tone: "muted" },
  a_verifier: { label: "À vérifier", tone: "info" },
  important: { label: "Important", tone: "warn" },
  bloquant: { label: "Bloquant", tone: "danger" },
};

export const CONSTRAINT_CATEGORY_LABEL: Record<ConstraintCategory, string> = {
  acces: "Accès / logistique",
  electricite: "Électricité",
  toiture: "Toiture / couverture",
  structure: "Structure / génie civil",
  hydraulique: "Hydraulique",
  frigorifique: "Frigorifique",
  securite: "Sécurité",
  client: "Client / administratif",
  materiel: "Matériel",
  autre: "Autre",
};

export const PHOTO_SKIP_REASON_LABEL: Record<PhotoSkipReason, string> = {
  inaccessible: "Zone inaccessible",
  equipement_absent: "Équipement absent",
  client_absent: "Client absent / refus",
  danger: "Danger / risque",
  autre: "Autre motif",
};

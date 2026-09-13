/**
 * PVIA Module Database — noyau métier du catalogue de panneaux.
 *
 * Module PUR (aucun import serveur / navigateur) : il définit les types
 * partagés, la géométrie réelle d'un panneau et les règles de validation.
 * Principe : une implantation n'utilise QUE des dimensions publiées.
 * Aucune dimension générique n'est inventée ici ni ailleurs.
 */

export type ModuleConfidence =
  | "manufacturer_verified"
  | "official_database"
  | "directory"
  | "company"
  | "to_verify";

export type ModuleStatus = "ACTIVE" | "DISCONTINUED" | "ARCHIVED" | "UNKNOWN";

export const CONFIDENCE_LABELS: Record<ModuleConfidence, string> = {
  manufacturer_verified: "Vérifié constructeur",
  official_database: "Vérifié base officielle",
  directory: "Annuaire",
  company: "Saisie entreprise",
  to_verify: "À vérifier",
};

export const STATUS_LABELS: Record<ModuleStatus, string> = {
  ACTIVE: "Commercialisé",
  DISCONTINUED: "Ancien modèle",
  ARCHIVED: "Archivé",
  UNKNOWN: "Statut inconnu",
};

export const MISSING_DIMENSIONS_MESSAGE =
  "Dimensions manquantes — impossible d'utiliser ce panneau pour l'implantation.";

/** Dimensions produit, en millimètres, telles que publiées par la source. */
export interface ModuleDimensions {
  width_mm: number | null;
  height_mm: number | null;
  depth_mm: number | null;
}

/** Référence complète affichée et enregistrée avec une implantation. */
export interface ModuleSnapshot {
  variant_id: string;
  revision_id: string | null;
  manufacturer: string;
  series: string;
  model: string;
  power_wc: number;
  width_mm: number;
  height_mm: number;
  depth_mm: number | null;
  weight_kg: number | null;
  confidence: ModuleConfidence;
  source: string | null;
}

/** Fiche compacte renvoyée par la recherche du catalogue. */
export interface ModuleListItem {
  variant_id: string;
  manufacturer: string;
  manufacturer_id: string;
  series_id: string;
  series: string;
  model: string;
  power_wc: number;
  width_mm: number | null;
  height_mm: number | null;
  depth_mm: number | null;
  weight_kg: number | null;
  efficiency_pct: number | null;
  technologies: string[];
  status: ModuleStatus;
  confidence: ModuleConfidence;
  source: string | null;
  is_company: boolean;
  is_favorite: boolean;
  last_used_at: string | null;
}

const MIN_SIDE_MM = 200;
const MAX_SIDE_MM = 4000;
const MIN_DEPTH_MM = 10;
const MAX_DEPTH_MM = 100;
const MIN_POWER_W = 10;
const MAX_POWER_W = 1500;

/** Un panneau n'est utilisable que si ses deux dimensions sont publiées. */
export function hasUsableDimensions(dim: ModuleDimensions): boolean {
  return isPlausibleSide(dim.width_mm) && isPlausibleSide(dim.height_mm);
}

function isPlausibleSide(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= MIN_SIDE_MM && value <= MAX_SIDE_MM;
}

/**
 * Encombrement réel en mètres, orientation comprise.
 * Portrait = grand côté dans le sens de la pente.
 */
export function moduleSizeMeters(
  dim: Pick<ModuleDimensions, "width_mm" | "height_mm">,
  orientation: "portrait" | "paysage",
): { width: number; length: number } {
  const w = (dim.width_mm ?? 0) / 1000;
  const h = (dim.height_mm ?? 0) / 1000;
  return orientation === "portrait" ? { width: w, length: h } : { width: h, length: w };
}

/** Épaisseur réelle en mètres pour la 3D ; repli neutre si non publiée. */
export function moduleDepthMeters(dim: ModuleDimensions, fallback = 0.035): number {
  const d = dim.depth_mm;
  if (typeof d === "number" && Number.isFinite(d) && d >= MIN_DEPTH_MM && d <= MAX_DEPTH_MM) return d / 1000;
  return fallback;
}

export function formatModuleDimensions(dim: ModuleDimensions): string {
  if (!hasUsableDimensions(dim)) return "Dimensions non publiées";
  const base = `${Math.round(dim.width_mm!)} × ${Math.round(dim.height_mm!)}`;
  return dim.depth_mm ? `${base} × ${Math.round(dim.depth_mm)} mm` : `${base} mm`;
}

export function formatModuleMeters(dim: ModuleDimensions): string {
  if (!hasUsableDimensions(dim)) return "—";
  return `${(dim.width_mm! / 1000).toFixed(3)} × ${(dim.height_mm! / 1000).toFixed(3)} m`;
}

export function formatModuleLabel(m: Pick<ModuleListItem, "manufacturer" | "model" | "power_wc">): string {
  return `${m.manufacturer} ${m.model} — ${m.power_wc} Wc`;
}

/** Normalisation identique côté base (accents, casse, ponctuation). */
export function normalizeModuleText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Recherche tolérante : tous les fragments doivent être présents. */
export function moduleMatchesQuery(haystack: string, query: string): boolean {
  const terms = normalizeModuleText(query).split(" ").filter(Boolean);
  if (!terms.length) return true;
  const target = normalizeModuleText(haystack);
  return terms.every((t) => target.includes(t));
}

export interface CustomModuleInput {
  manufacturer: string;
  model: string;
  power_wc: number;
  width_mm: number;
  height_mm: number;
  depth_mm?: number | null;
  weight_kg?: number | null;
}

/**
 * Bornes de cohérence : on refuse une saisie aberrante plutôt que de
 * laisser entrer une dimension fausse dans le catalogue.
 */
export function validateCustomModule(input: CustomModuleInput): string[] {
  const errors: string[] = [];
  if (input.manufacturer.trim().length < 2) errors.push("Le fabricant est obligatoire.");
  if (input.model.trim().length < 2) errors.push("Le modèle est obligatoire.");
  if (!(input.power_wc >= MIN_POWER_W && input.power_wc <= MAX_POWER_W)) {
    errors.push(`La puissance doit être comprise entre ${MIN_POWER_W} et ${MAX_POWER_W} Wc.`);
  }
  if (!isPlausibleSide(input.width_mm)) {
    errors.push(`La largeur doit être comprise entre ${MIN_SIDE_MM} et ${MAX_SIDE_MM} mm.`);
  }
  if (!isPlausibleSide(input.height_mm)) {
    errors.push(`La hauteur doit être comprise entre ${MIN_SIDE_MM} et ${MAX_SIDE_MM} mm.`);
  }
  if (input.depth_mm != null && (input.depth_mm < MIN_DEPTH_MM || input.depth_mm > MAX_DEPTH_MM)) {
    errors.push(`L'épaisseur doit être comprise entre ${MIN_DEPTH_MM} et ${MAX_DEPTH_MM} mm.`);
  }
  if (input.weight_kg != null && (input.weight_kg <= 0 || input.weight_kg > 120)) {
    errors.push("Le poids doit être compris entre 0 et 120 kg.");
  }
  return errors;
}

/** Deux références sont substituables sans recalcul si la géométrie est identique. */
export function isGeometricallyInterchangeable(a: ModuleDimensions, b: ModuleDimensions): boolean {
  if (!hasUsableDimensions(a) || !hasUsableDimensions(b)) return false;
  return a.width_mm === b.width_mm && a.height_mm === b.height_mm;
}

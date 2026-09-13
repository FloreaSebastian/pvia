/**
 * Smart PV Layout Engine — types du moteur d'implantation.
 *
 * Module PUR : aucune dépendance React, Three.js, Google Maps ou serveur.
 * Toutes les longueurs sont en mètres, dans le repère local (u,v) du pan
 * (u = le long de l'égout, v = montant la pente).
 */

/** Version de l'algorithme. Toute évolution du résultat l'incrémente. */
export const LAYOUT_ENGINE_VERSION = "1.0.0";

export interface Pt {
  x: number;
  y: number;
}

export type Orientation = "portrait" | "paysage";
export type OrientationMode = "auto" | "portrait" | "paysage" | "mixte";
export type Strategy = "equilibre" | "esthetique" | "maximum";

export interface LayoutModuleSpec {
  id: string;
  width_mm: number;
  height_mm: number;
  power_wc: number;
}

/** Obstacle projeté dans le repère (u,v) du pan, emprise rectangulaire. */
export interface LayoutObstacle {
  id: string;
  u: number;
  v: number;
  width_m: number;
  length_m: number;
  /** Marge propre à l'obstacle ; à défaut celle du profil de règles. */
  clearance_m?: number;
}

export type LayoutZoneType =
  | "interdite"
  | "passage"
  | "prioritaire"
  | "technique"
  | "reservee"
  | "panneaux";

export interface LayoutZone {
  id: string;
  type: LayoutZoneType;
  polygon: Pt[];
}

export interface LayoutPlane {
  key: string;
  name: string;
  azimuth_deg: number;
  tilt_deg: number;
  /** Contour réel du pan : rectangle, triangle, trapèze, quelconque, concave. */
  polygon: Pt[];
  obstacles: LayoutObstacle[];
  zones: LayoutZone[];
}

/**
 * Profil de règles d'une entreprise. Aucune valeur n'est imposée par le
 * moteur : l'appelant fournit le profil réellement configuré.
 */
export interface RulesProfile {
  id: string;
  name: string;
  version: number;
  /** Recul en bas de pan (égout). */
  eave_m: number;
  /** Recul en haut de pan (faîtage). */
  ridge_m: number;
  /** Recul latéral (rive). */
  verge_m: number;
  /** Recul en noue. */
  valley_m: number;
  /** Recul en arêtier. */
  hip_m: number;
  /** Marge par défaut autour des obstacles. */
  obstacle_m: number;
  /** Espacement entre rangées. */
  row_gap_m: number;
  /** Espacement entre colonnes. */
  col_gap_m: number;
  /** Largeur d'un passage technique dessiné. */
  walkway_m: number;
}

export type TargetMode = "max" | "power" | "count";
/** Arbitrage lorsqu'aucune solution exacte n'existe. */
export type TargetRounding = "closest" | "under" | "over";

export interface LayoutTarget {
  mode: TargetMode;
  /** Puissance visée en kWc (mode "power"). */
  power_kwc?: number;
  /** Nombre de modules visé (mode "count"). */
  count?: number;
  rounding: TargetRounding;
}

export interface LayoutModule {
  /** Identifiant stable, réutilisable par le futur moteur électrique. */
  id: string;
  plane_key: string;
  u: number;
  v: number;
  orientation: Orientation;
  row: number;
  col: number;
  /** Indice de la matrice (groupe de modules contigus) sur ce pan. */
  matrix: number;
}

export interface ScoreCriteria {
  module_count: number;
  power_kwc: number;
  /** Écart absolu à la puissance cible, en kWc. null si pas de cible. */
  target_gap_kwc: number | null;
  matrices: number;
  /** Part de la zone exploitable réellement couverte, 0–1. */
  fill_ratio: number;
  /** Part des modules appartenant à une rangée pleine, 0–1. */
  alignment_ratio: number;
  /** Densité dans l'emprise des modules posés, 0–1. */
  compactness: number;
  isolated_modules: number;
  /** Modules posés dans une zone prioritaire. */
  in_priority_zone: number;
}

export interface LayoutCandidate {
  id: string;
  label: string;
  strategy: Strategy;
  orientation: Orientation | "mixte";
  modules: LayoutModule[];
  power_kwc: number;
  criteria: ScoreCriteria;
  score: number;
  /** Explication lisible, jamais un score opaque. */
  reasons: string[];
  /** Empreinte géométrique : deux candidats identiques ne sont pas dupliqués. */
  signature: string;
  engine_version: string;
}

export type ValidityStatus = "valid" | "warning" | "invalid";

export type ValidityCause =
  | "hors_toiture"
  | "recul_insuffisant"
  | "collision_obstacle"
  | "zone_interdite"
  | "passage_technique"
  | "collision_module";

export interface ModuleValidity {
  module_id: string;
  status: ValidityStatus;
  cause: ValidityCause | null;
  /** Distance mesurée, en mètres, lorsqu'elle a un sens. */
  measured_m: number | null;
  /** Seuil du profil de règles, en mètres. */
  required_m: number | null;
  message: string;
}

export interface LayoutRequest {
  planes: LayoutPlane[];
  /** Ordre de priorité des pans, par clé. Aucun pan n'est réputé plus productif. */
  plane_priority?: string[];
  module: LayoutModuleSpec;
  rules: RulesProfile;
  target: LayoutTarget;
  orientation: OrientationMode;
  strategies?: Strategy[];
  /** Nombre maximal de variantes retournées. */
  max_variants?: number;
}

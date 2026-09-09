/**
 * Solar Studio — types du jumeau numérique.
 *
 * Module PUR (aucun import serveur ni React). Le schéma JSON est versionné :
 * toute évolution incompatible incrémente SOLAR_SCHEMA_VERSION.
 */
import type { LocalPoint } from "./geo";

export const SOLAR_SCHEMA_VERSION = 1;

/** Niveau de confiance global du modèle. Jamais deviné : issu des sources réelles. */
export type SolarQualityLevel = "pre_etude" | "lidar" | "terrain_verifie" | "drone";

export const SOLAR_QUALITY_META: Record<SolarQualityLevel, { label: string; help: string }> = {
  pre_etude: {
    label: "Pré-étude",
    help: "Saisie déclarative avant-vente. Dimensions à confirmer par la visite technique.",
  },
  lidar: { label: "Données LiDAR", help: "Géométrie issue de données altimétriques publiques." },
  terrain_verifie: { label: "Vérifié terrain", help: "Dimensions confirmées lors de la visite technique." },
  drone: { label: "Relevé drone", help: "Géométrie issue d'un relevé photogrammétrique." },
};

/** Provenance d'une donnée, obligatoire sur toute géométrie. */
export type SolarDataSourceKind =
  | "manuel"
  | "automatique"
  | "lidar"
  | "satellite"
  | "mesure_manuelle"
  | "visite_technique"
  | "drone"
  | "import"
  | "corrige_utilisateur";

export const SOLAR_SOURCE_LABELS: Record<SolarDataSourceKind, string> = {
  manuel: "Saisie manuelle",
  automatique: "Généré automatiquement",
  lidar: "LiDAR",
  satellite: "Vue satellite",
  mesure_manuelle: "Mesure sur site",
  visite_technique: "Visite technique",
  drone: "Relevé drone",
  import: "Import de fichier",
  corrige_utilisateur: "Corrigé manuellement",
};

export type RoofType = "monopente" | "deux_pans" | "quatre_pans" | "terrasse";

export const ROOF_TYPE_META: Record<RoofType, { label: string; help: string }> = {
  monopente: { label: "Monopente", help: "Un seul pan incliné." },
  deux_pans: { label: "Deux pans", help: "Toiture à faîtage central." },
  quatre_pans: { label: "Quatre pans", help: "Toiture en croupe." },
  terrasse: { label: "Toit-terrasse", help: "Toiture plate, pose sur bacs lestés." },
};

export type ObstacleType =
  | "cheminee"
  | "velux"
  | "chien_assis"
  | "antenne"
  | "climatisation"
  | "ventilation"
  | "arbre"
  | "batiment_voisin"
  | "mur"
  | "poteau"
  | "autre";

export const OBSTACLE_META: Record<ObstacleType, { label: string; onRoof: boolean; defaultHeight: number }> = {
  cheminee: { label: "Cheminée", onRoof: true, defaultHeight: 1.2 },
  velux: { label: "Velux / fenêtre de toit", onRoof: true, defaultHeight: 0.15 },
  chien_assis: { label: "Chien-assis", onRoof: true, defaultHeight: 1.4 },
  antenne: { label: "Antenne", onRoof: true, defaultHeight: 1.5 },
  climatisation: { label: "Unité de climatisation", onRoof: true, defaultHeight: 0.9 },
  ventilation: { label: "Sortie de ventilation", onRoof: true, defaultHeight: 0.5 },
  arbre: { label: "Arbre", onRoof: false, defaultHeight: 8 },
  batiment_voisin: { label: "Bâtiment voisin", onRoof: false, defaultHeight: 7 },
  mur: { label: "Mur", onRoof: false, defaultHeight: 2.5 },
  poteau: { label: "Poteau / pylône", onRoof: false, defaultHeight: 8 },
  autre: { label: "Autre obstacle", onRoof: true, defaultHeight: 1 },
};

export type ZoneType = "interdite" | "prioritaire" | "technique" | "passage" | "reservee" | "panneaux";

export const ZONE_META: Record<ZoneType, { label: string; color: string }> = {
  interdite: { label: "Zone interdite", color: "#ef4444" },
  prioritaire: { label: "Zone prioritaire", color: "#22c55e" },
  technique: { label: "Zone technique", color: "#f59e0b" },
  passage: { label: "Cheminement", color: "#38bdf8" },
  reservee: { label: "Réservation future", color: "#a78bfa" },
  panneaux: { label: "Zone de pose", color: "#0ea5e9" },
};

export type ModuleOrientation = "portrait" | "paysage";

export interface SolarModuleSpec {
  id: string;
  manufacturer: string;
  reference: string;
  power_wc: number;
  width_mm: number;
  height_mm: number;
  technology: string | null;
  efficiency_pct: number | null;
}

/** Repère d'un pan : origine 3D + axes unitaires u (le long du faîtage) et v (montant la pente). */
export interface PlaneFrame {
  origin: [number, number, number];
  u: [number, number, number];
  v: [number, number, number];
  normal: [number, number, number];
}

export interface RoofPlaneGeometry {
  key: string;
  name: string;
  azimuth_deg: number;
  tilt_deg: number;
  area_m2: number;
  /** Contour du pan dans son repère (u,v), en mètres. */
  polygon: LocalPoint[];
  frame: PlaneFrame;
  eave_height_m: number;
  ridge_height_m: number;
}

export interface BuildingParams {
  roof_type: RoofType;
  width_m: number;
  depth_m: number;
  wall_height_m: number;
  tilt_deg: number;
  /** Azimut du pan principal (0 = Nord, 180 = Sud). */
  azimuth_deg: number;
  /** Débord de toiture, appliqué sur tout le pourtour. */
  overhang_m: number;
}

export const DEFAULT_BUILDING_PARAMS: BuildingParams = {
  roof_type: "deux_pans",
  width_m: 10,
  depth_m: 8,
  wall_height_m: 3,
  tilt_deg: 30,
  azimuth_deg: 180,
  overhang_m: 0.3,
};

export interface PlacedModule {
  id: string;
  roof_plane_key: string;
  grid_row: number;
  grid_col: number;
  /** Centre du panneau dans le repère (u,v) du pan. */
  local_u_m: number;
  local_v_m: number;
  orientation: ModuleOrientation;
  enabled: boolean;
}

export interface SolarSummary {
  module_count: number;
  power_kwc: number;
  module_area_m2: number;
  roof_area_m2: number;
  coverage_pct: number;
  main_azimuth_deg: number | null;
  main_tilt_deg: number | null;
  quality_level: SolarQualityLevel;
}

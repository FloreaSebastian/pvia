/**
 * Solar Studio — interfaces génériques de fournisseurs géospatiaux.
 *
 * Solar Studio n'est JAMAIS codé autour de l'IGN : tout passe par ces
 * interfaces. Ajouter un pays ou un fournisseur revient à écrire un adaptateur.
 * Chaque réponse transporte sa provenance complète.
 */
import type { LatLon } from "../geo";

export type DatasetKind =
  | "geocoding"
  | "imagery"
  | "elevation"
  | "terrain_model"
  | "surface_model"
  | "height_model"
  | "lidar"
  | "building_footprint";

export const DATASET_LABEL: Record<DatasetKind, string> = {
  geocoding: "Adresses",
  imagery: "Orthophotographie",
  elevation: "Altimétrie",
  terrain_model: "Modèle numérique de terrain (MNT)",
  surface_model: "Modèle numérique de surface (MNS)",
  height_model: "Modèle numérique de hauteur (MNH)",
  lidar: "LiDAR HD",
  building_footprint: "Emprises de bâtiments",
};

export interface BoundingBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Métadonnées obligatoires sur toute donnée renvoyée par un fournisseur. */
export interface SourceMetadata {
  provider: string;
  dataset: string;
  dataset_kind: DatasetKind;
  dataset_version: string | null;
  crs: string;
  resolution_m: number | null;
  bbox: BoundingBox | null;
  acquisition_date: string | null;
  attribution: string;
  license: string;
  /** Précision officielle telle que publiée par la source, jamais inventée. */
  documented_accuracy: string | null;
  fetched_at: string;
}

export type ProviderResult<T> =
  | { ok: true; data: T; metadata: SourceMetadata }
  | { ok: false; error: ProviderError; metadata: Partial<SourceMetadata> };

export interface ProviderError {
  code: "unavailable" | "no_coverage" | "timeout" | "rate_limited" | "invalid_response" | "not_supported";
  message: string;
}

export const PROVIDER_ERROR_MESSAGE: Record<ProviderError["code"], string> = {
  unavailable: "Donnée géographique temporairement indisponible.",
  no_coverage: "Aucune donnée disponible pour cette adresse.",
  timeout: "Donnée géographique temporairement indisponible.",
  rate_limited: "Service géographique momentanément saturé.",
  invalid_response: "Réponse du service géographique inexploitable.",
  not_supported: "Source non prise en charge pour ce secteur.",
};

/** Disponibilité d'un jeu de données sur une localisation donnée. */
export interface CoverageStatus {
  dataset_kind: DatasetKind;
  label: string;
  available: boolean;
  provider: string | null;
  dataset: string | null;
  detail: string;
  resolution_m: number | null;
  acquisition_date: string | null;
  attribution: string | null;
}

export interface GeocodeCandidate {
  label: string;
  address: string;
  postal_code: string;
  city: string;
  latitude: number;
  longitude: number;
  score: number;
  kind: string;
}

export interface ElevationSampleResult {
  latitude: number;
  longitude: number;
  altitude_m: number;
}

export interface ImageryLayer {
  /** Modèle d'URL de tuiles XYZ, utilisable directement par la carte. */
  tile_url_template: string;
  min_zoom: number;
  max_zoom: number;
  tile_size: number;
}

export interface BuildingFootprint {
  /** Contour en WGS84, sens horaire ou anti-horaire indifférent. */
  ring: LatLon[];
  height_m: number | null;
  levels: number | null;
  source_id: string | null;
}

/* ------------------------------ Interfaces -------------------------------- */

export interface GeocodingProvider {
  readonly name: string;
  search(query: string, limit?: number): Promise<ProviderResult<GeocodeCandidate[]>>;
  reverse(point: LatLon): Promise<ProviderResult<GeocodeCandidate[]>>;
}

export interface ImageryProvider {
  readonly name: string;
  getLayer(kind: "plan" | "orthophoto"): ProviderResult<ImageryLayer>;
}

export interface ElevationProvider {
  readonly name: string;
  sample(points: LatLon[]): Promise<ProviderResult<ElevationSampleResult[]>>;
}

export interface TerrainModelProvider {
  readonly name: string;
  /** Grille d'altitudes du SOL sur une emprise. */
  sampleGrid(center: LatLon, radius_m: number, step_m: number): Promise<ProviderResult<ElevationSampleResult[]>>;
}

export interface SurfaceModelProvider {
  readonly name: string;
  /** Grille d'altitudes de la SURFACE observée (toitures, arbres…). */
  sampleGrid(center: LatLon, radius_m: number, step_m: number): Promise<ProviderResult<ElevationSampleResult[]>>;
}

export interface HeightModelProvider {
  readonly name: string;
  /** Hauteurs RELATIVES au terrain, si le fournisseur les publie. */
  sampleGrid(center: LatLon, radius_m: number, step_m: number): Promise<ProviderResult<ElevationSampleResult[]>>;
}

export interface LidarPointSet {
  /** Points déjà réduits à l'emprise du projet, en coordonnées locales. */
  points: { x: number; y: number; z: number; classification: number }[];
  /** Classifications SOURCE conservées telles quelles. */
  classifications: Record<number, string>;
  derived: boolean;
}

export interface LidarProvider {
  readonly name: string;
  fetchPointSet(center: LatLon, radius_m: number): Promise<ProviderResult<LidarPointSet>>;
}

export interface BuildingFootprintProvider {
  readonly name: string;
  findAt(point: LatLon): Promise<ProviderResult<BuildingFootprint[]>>;
}

export interface GeoDataProvider
  extends Partial<
    GeocodingProvider &
      ImageryProvider &
      ElevationProvider &
      TerrainModelProvider &
      SurfaceModelProvider &
      HeightModelProvider &
      LidarProvider &
      BuildingFootprintProvider
  > {
  readonly name: string;
  readonly attribution: string;
  checkCoverage(point: LatLon): Promise<CoverageStatus[]>;
}

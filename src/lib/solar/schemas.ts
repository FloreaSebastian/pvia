/** Solar Studio — schémas de validation partagés (client + serveur). */
import { z } from "zod";

export const RoofTypeSchema = z.enum(["monopente", "deux_pans", "quatre_pans", "terrasse"]);

export const QualityLevelSchema = z.enum(["pre_etude", "lidar", "terrain_verifie", "drone"]);

export const ObstacleTypeSchema = z.enum([
  "cheminee",
  "velux",
  "chien_assis",
  "antenne",
  "climatisation",
  "ventilation",
  "arbre",
  "batiment_voisin",
  "mur",
  "poteau",
  "autre",
]);

export const OrientationSchema = z.enum(["portrait", "paysage"]);

export const BuildingParamsSchema = z.object({
  roof_type: RoofTypeSchema,
  width_m: z.number().min(1).max(200),
  depth_m: z.number().min(1).max(200),
  wall_height_m: z.number().min(0).max(60),
  tilt_deg: z.number().min(0).max(70),
  azimuth_deg: z.number().min(0).max(360),
  overhang_m: z.number().min(0).max(3),
});

export const SaveBuildingSchema = z.object({
  companyId: z.string().uuid(),
  modelId: z.string().uuid(),
  name: z.string().trim().max(120).optional(),
  params: BuildingParamsSchema,
  /** Détection de conflit : version géométrique connue du client. */
  expectedGeometryVersion: z.number().int().min(1).nullable().optional(),
});


export const ObstacleInputSchema = z.object({
  companyId: z.string().uuid(),
  modelId: z.string().uuid(),
  obstacleId: z.string().uuid().nullable().optional(),
  roofPlaneId: z.string().uuid().nullable().optional(),
  obstacle_type: ObstacleTypeSchema,
  label: z.string().trim().max(120).optional().default(""),
  position_x_m: z.number().min(-500).max(500),
  position_y_m: z.number().min(-500).max(500),
  base_z_m: z.number().min(-50).max(200).optional().default(0),
  width_m: z.number().min(0.05).max(100),
  length_m: z.number().min(0.05).max(100),
  height_m: z.number().min(0.01).max(80),
  rotation_deg: z.number().min(-360).max(360).optional().default(0),
  clearance_m: z.number().min(0).max(10).optional().default(0.3),
  casts_shadow: z.boolean().optional().default(true),
  data_source: z
    .enum([
      "manuel",
      "automatique",
      "lidar",
      "satellite",
      "mesure_manuelle",
      "visite_technique",
      "drone",
      "import",
      "corrige_utilisateur",
    ])
    .optional()
    .default("manuel"),
});

export const LayoutRequestSchema = z.object({
  companyId: z.string().uuid(),
  modelId: z.string().uuid(),
  roofPlaneId: z.string().uuid(),
  moduleCatalogId: z.string().uuid(),
  orientation: OrientationSchema.default("portrait"),
  setback_m: z.number().min(0).max(5).default(0.4),
  row_gap_m: z.number().min(0).max(1).default(0.02),
  col_gap_m: z.number().min(0).max(1).default(0.02),
  max_modules: z.number().int().min(1).max(2000).nullable().optional(),
});

export const ToggleModuleSchema = z.object({
  companyId: z.string().uuid(),
  modelId: z.string().uuid(),
  moduleId: z.string().uuid(),
  enabled: z.boolean(),
});

export const ModelMetaSchema = z.object({
  companyId: z.string().uuid(),
  modelId: z.string().uuid(),
  name: z.string().trim().min(1).max(120).optional(),
  quality_level: QualityLevelSchema.optional(),
});

export const VersionSchema = z.object({
  companyId: z.string().uuid(),
  modelId: z.string().uuid(),
  label: z.string().trim().max(120).optional().default(""),
});

/* ------------------------- Phase 2 : géospatial --------------------------- */

export const SourceTypeSchema = z.enum([
  "AUTO",
  "LIDAR",
  "MNS",
  "MNH",
  "MNT",
  "MAP",
  "MANUAL",
  "FIELD",
  "DRONE",
  "IMPORT",
]);

export const ConfidenceSchema = z.enum(["estimated", "derived_3d", "measured", "field_verified"]);
export const VerificationStatusSchema = z.enum(["unverified", "to_verify", "verified", "rejected"]);

export const AddressSearchSchema = z.object({
  companyId: z.string().uuid(),
  query: z.string().trim().min(3).max(200),
});

export const ConfirmLocationSchema = z.object({
  companyId: z.string().uuid(),
  modelId: z.string().uuid(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  address: z.string().trim().max(200).optional().default(""),
  postal_code: z.string().trim().max(12).optional().default(""),
  city: z.string().trim().max(120).optional().default(""),
  label: z.string().trim().max(240).optional().default(""),
});

export const SiteDataSchema = z.object({
  companyId: z.string().uuid(),
  modelId: z.string().uuid(),
  refresh: z.boolean().optional().default(false),
});

export const JobTypeSchema = z.enum([
  "FETCH_ELEVATION",
  "FETCH_LIDAR",
  "GENERATE_TERRAIN",
  "DETECT_ROOF",
  "GENERATE_SURFACE",
]);

export const StartJobSchema = z.object({
  companyId: z.string().uuid(),
  modelId: z.string().uuid(),
  jobType: JobTypeSchema,
  force: z.boolean().optional().default(false),
});

export const JobRefSchema = z.object({
  companyId: z.string().uuid(),
  modelId: z.string().uuid(),
  jobId: z.string().uuid(),
});

export const MeasureKindSchema = z.enum([
  "distance",
  "distance_horizontal",
  "distance_3d",
  "height",
  "elevation_delta",
  "angle",
  "slope",
  "area",
]);

export const MeasureCategorySchema = z.enum([
  "largeur",
  "longueur",
  "hauteur",
  "distance_obstacle",
  "distance_rive",
  "autre",
]);

export const SaveMeasurementSchema = z.object({
  companyId: z.string().uuid(),
  modelId: z.string().uuid(),
  measurementId: z.string().uuid().nullable().optional(),
  measure_type: MeasureKindSchema,
  category: MeasureCategorySchema.default("autre"),
  label: z.string().trim().min(1).max(120),
  value_numeric: z.number().finite(),
  unit: z.string().trim().max(8).default("m"),
  pinned: z.boolean().default(true),
  target_kind: z.string().trim().max(40).nullable().optional(),
  target_id: z.string().uuid().nullable().optional(),
  geometry: z.array(z.tuple([z.number(), z.number(), z.number()])).max(64).default([]),
  data_source: SourceTypeSchema.default("MANUAL"),
});

export const FieldMeasurementSchema = z.object({
  companyId: z.string().uuid(),
  modelId: z.string().uuid(),
  measurementId: z.string().uuid(),
  value_field: z.number().finite(),
  verification_method: z.string().trim().max(80).default("mesure sur site"),
  retain: z.boolean().default(true),
});

export const DimensionConstraintSchema = z.object({
  companyId: z.string().uuid(),
  modelId: z.string().uuid(),
  target: z.enum(["width_m", "depth_m", "wall_height_m", "tilt_deg"]),
  value: z.number().finite().min(0).max(200),
  measurementId: z.string().uuid().nullable().optional(),
  expectedGeometryVersion: z.number().int().min(1).nullable().optional(),
});

export const ApplyProposalSchema = z.object({
  companyId: z.string().uuid(),
  modelId: z.string().uuid(),
  jobId: z.string().uuid(),
  expectedGeometryVersion: z.number().int().min(1).nullable().optional(),
});

export const RevertGeometrySchema = z.object({
  companyId: z.string().uuid(),
  modelId: z.string().uuid(),
});

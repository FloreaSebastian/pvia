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

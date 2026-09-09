-- ============ SOLAR STUDIO — socle (additif) ============

-- 1. MODELES
CREATE TABLE public.solar_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  study_id uuid REFERENCES public.technical_studies(id) ON DELETE SET NULL,
  chantier_id uuid REFERENCES public.chantiers(id) ON DELETE SET NULL,
  name text NOT NULL DEFAULT 'Modélisation',
  status text NOT NULL DEFAULT 'draft',
  quality_level text NOT NULL DEFAULT 'pre_etude',
  address text NOT NULL DEFAULT '',
  postal_code text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT '',
  latitude double precision,
  longitude double precision,
  origin_latitude double precision,
  origin_longitude double precision,
  geocode_source text,
  geocode_score double precision,
  schema_version integer NOT NULL DEFAULT 1,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT solar_models_quality_check CHECK (quality_level IN ('pre_etude','lidar','terrain_verifie','drone')),
  CONSTRAINT solar_models_status_check CHECK (status IN ('draft','active','archived'))
);
CREATE INDEX solar_models_company_idx ON public.solar_models(company_id);
CREATE UNIQUE INDEX solar_models_study_unique ON public.solar_models(study_id) WHERE study_id IS NOT NULL;

-- 2. VERSIONS
CREATE TABLE public.solar_model_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  model_id uuid NOT NULL REFERENCES public.solar_models(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  label text NOT NULL DEFAULT '',
  quality_level text NOT NULL DEFAULT 'pre_etude',
  snapshot jsonb NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (model_id, version_number)
);
CREATE INDEX solar_model_versions_model_idx ON public.solar_model_versions(model_id);

-- 3. BATIMENTS
CREATE TABLE public.solar_buildings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  model_id uuid NOT NULL REFERENCES public.solar_models(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Bâtiment',
  kind text NOT NULL DEFAULT 'principal',
  roof_type text NOT NULL DEFAULT 'deux_pans',
  footprint jsonb NOT NULL DEFAULT '[]'::jsonb,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  wall_height_m double precision NOT NULL DEFAULT 3,
  rotation_deg double precision NOT NULL DEFAULT 0,
  position_x_m double precision NOT NULL DEFAULT 0,
  position_y_m double precision NOT NULL DEFAULT 0,
  ground_z_m double precision NOT NULL DEFAULT 0,
  data_source text NOT NULL DEFAULT 'manuel',
  source_ref text,
  source_date date,
  verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  verified_at timestamptz,
  schema_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX solar_buildings_model_idx ON public.solar_buildings(model_id);

-- 4. PANS DE TOITURE
CREATE TABLE public.solar_roof_planes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  model_id uuid NOT NULL REFERENCES public.solar_models(id) ON DELETE CASCADE,
  building_id uuid NOT NULL REFERENCES public.solar_buildings(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Pan',
  azimuth_deg double precision NOT NULL DEFAULT 180,
  tilt_deg double precision NOT NULL DEFAULT 30,
  area_m2 double precision NOT NULL DEFAULT 0,
  ridge_height_m double precision,
  eave_height_m double precision,
  polygon jsonb NOT NULL DEFAULT '[]'::jsonb,
  covering text,
  data_source text NOT NULL DEFAULT 'manuel',
  source_ref text,
  source_date date,
  verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  verified_at timestamptz,
  schema_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX solar_roof_planes_model_idx ON public.solar_roof_planes(model_id);
CREATE INDEX solar_roof_planes_building_idx ON public.solar_roof_planes(building_id);

-- 5. OBSTACLES
CREATE TABLE public.solar_obstacles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  model_id uuid NOT NULL REFERENCES public.solar_models(id) ON DELETE CASCADE,
  roof_plane_id uuid REFERENCES public.solar_roof_planes(id) ON DELETE SET NULL,
  obstacle_type text NOT NULL,
  label text NOT NULL DEFAULT '',
  position_x_m double precision NOT NULL DEFAULT 0,
  position_y_m double precision NOT NULL DEFAULT 0,
  base_z_m double precision NOT NULL DEFAULT 0,
  width_m double precision NOT NULL DEFAULT 0.6,
  length_m double precision NOT NULL DEFAULT 0.6,
  height_m double precision NOT NULL DEFAULT 1,
  rotation_deg double precision NOT NULL DEFAULT 0,
  clearance_m double precision NOT NULL DEFAULT 0,
  casts_shadow boolean NOT NULL DEFAULT true,
  vegetation_state text,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  data_source text NOT NULL DEFAULT 'manuel',
  source_ref text,
  source_date date,
  verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  verified_at timestamptz,
  schema_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX solar_obstacles_model_idx ON public.solar_obstacles(model_id);

-- 6. ZONES
CREATE TABLE public.solar_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  model_id uuid NOT NULL REFERENCES public.solar_models(id) ON DELETE CASCADE,
  roof_plane_id uuid REFERENCES public.solar_roof_planes(id) ON DELETE CASCADE,
  zone_type text NOT NULL,
  label text NOT NULL DEFAULT '',
  polygon jsonb NOT NULL DEFAULT '[]'::jsonb,
  schema_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT solar_zones_type_check CHECK (zone_type IN ('interdite','prioritaire','technique','passage','reservee','panneaux'))
);
CREATE INDEX solar_zones_model_idx ON public.solar_zones(model_id);

-- 7. CATALOGUE MODULES
CREATE TABLE public.solar_module_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  manufacturer text NOT NULL,
  reference text NOT NULL,
  power_wc integer NOT NULL,
  width_mm integer NOT NULL,
  height_mm integer NOT NULL,
  thickness_mm integer,
  technology text,
  efficiency_pct double precision,
  cell_count integer,
  bypass_diodes integer,
  electrical jsonb NOT NULL DEFAULT '{}'::jsonb,
  datasheet_url text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX solar_module_catalog_company_idx ON public.solar_module_catalog(company_id);

-- 8. IMPLANTATIONS
CREATE TABLE public.solar_arrays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  model_id uuid NOT NULL REFERENCES public.solar_models(id) ON DELETE CASCADE,
  roof_plane_id uuid NOT NULL REFERENCES public.solar_roof_planes(id) ON DELETE CASCADE,
  module_catalog_id uuid REFERENCES public.solar_module_catalog(id) ON DELETE SET NULL,
  label text NOT NULL DEFAULT 'Champ',
  orientation text NOT NULL DEFAULT 'portrait',
  row_gap_m double precision NOT NULL DEFAULT 0.02,
  col_gap_m double precision NOT NULL DEFAULT 0.02,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT solar_arrays_orientation_check CHECK (orientation IN ('portrait','paysage'))
);
CREATE INDEX solar_arrays_model_idx ON public.solar_arrays(model_id);

-- 9. PANNEAUX POSES
CREATE TABLE public.solar_modules_placed (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  model_id uuid NOT NULL REFERENCES public.solar_models(id) ON DELETE CASCADE,
  array_id uuid NOT NULL REFERENCES public.solar_arrays(id) ON DELETE CASCADE,
  roof_plane_id uuid NOT NULL REFERENCES public.solar_roof_planes(id) ON DELETE CASCADE,
  index_label integer NOT NULL DEFAULT 1,
  grid_row integer,
  grid_col integer,
  local_u_m double precision NOT NULL DEFAULT 0,
  local_v_m double precision NOT NULL DEFAULT 0,
  orientation text NOT NULL DEFAULT 'portrait',
  enabled boolean NOT NULL DEFAULT true,
  analysis jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX solar_modules_placed_model_idx ON public.solar_modules_placed(model_id);
CREATE INDEX solar_modules_placed_array_idx ON public.solar_modules_placed(array_id);

-- 10. MESURES
CREATE TABLE public.solar_measurements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  model_id uuid NOT NULL REFERENCES public.solar_models(id) ON DELETE CASCADE,
  measure_type text NOT NULL,
  label text NOT NULL DEFAULT '',
  value_numeric double precision,
  unit text,
  geometry jsonb NOT NULL DEFAULT '{}'::jsonb,
  target_kind text,
  target_id uuid,
  data_source text NOT NULL DEFAULT 'manuel',
  pinned boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX solar_measurements_model_idx ON public.solar_measurements(model_id);

-- 11. SOURCES DE DONNEES
CREATE TABLE public.solar_data_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  model_id uuid NOT NULL REFERENCES public.solar_models(id) ON DELETE CASCADE,
  provider text NOT NULL,
  dataset text NOT NULL,
  api_version text,
  license text,
  attribution text,
  source_date date,
  documented_accuracy text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX solar_data_sources_model_idx ON public.solar_data_sources(model_id);

-- 12. ANALYSES
CREATE TABLE public.solar_analysis_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  model_id uuid NOT NULL REFERENCES public.solar_models(id) ON DELETE CASCADE,
  run_type text NOT NULL,
  algorithm_version text NOT NULL,
  inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  results jsonb NOT NULL DEFAULT '{}'::jsonb,
  solar_source text,
  status text NOT NULL DEFAULT 'completed',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX solar_analysis_runs_model_idx ON public.solar_analysis_runs(model_id);

-- 13. PIECES JOINTES
CREATE TABLE public.solar_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  model_id uuid NOT NULL REFERENCES public.solar_models(id) ON DELETE CASCADE,
  target_kind text NOT NULL,
  target_id uuid,
  anchor jsonb NOT NULL DEFAULT '{}'::jsonb,
  storage_path text NOT NULL,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL DEFAULT 0,
  caption text NOT NULL DEFAULT '',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX solar_attachments_model_idx ON public.solar_attachments(model_id);

-- ============ GRANTS ============
GRANT SELECT, INSERT, UPDATE, DELETE ON public.solar_models TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.solar_model_versions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.solar_buildings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.solar_roof_planes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.solar_obstacles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.solar_zones TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.solar_module_catalog TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.solar_arrays TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.solar_modules_placed TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.solar_measurements TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.solar_data_sources TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.solar_analysis_runs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.solar_attachments TO authenticated;
GRANT ALL ON public.solar_models TO service_role;
GRANT ALL ON public.solar_model_versions TO service_role;
GRANT ALL ON public.solar_buildings TO service_role;
GRANT ALL ON public.solar_roof_planes TO service_role;
GRANT ALL ON public.solar_obstacles TO service_role;
GRANT ALL ON public.solar_zones TO service_role;
GRANT ALL ON public.solar_module_catalog TO service_role;
GRANT ALL ON public.solar_arrays TO service_role;
GRANT ALL ON public.solar_modules_placed TO service_role;
GRANT ALL ON public.solar_measurements TO service_role;
GRANT ALL ON public.solar_data_sources TO service_role;
GRANT ALL ON public.solar_analysis_runs TO service_role;
GRANT ALL ON public.solar_attachments TO service_role;

-- ============ RLS ============
ALTER TABLE public.solar_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solar_model_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solar_buildings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solar_roof_planes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solar_obstacles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solar_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solar_module_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solar_arrays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solar_modules_placed ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solar_measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solar_data_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solar_analysis_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solar_attachments ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'solar_models','solar_model_versions','solar_buildings','solar_roof_planes',
    'solar_obstacles','solar_zones','solar_arrays','solar_modules_placed',
    'solar_measurements','solar_data_sources','solar_analysis_runs','solar_attachments'
  ] LOOP
    EXECUTE format($f$
      CREATE POLICY %1$s_select ON public.%1$I FOR SELECT TO authenticated
        USING (public.is_company_member(company_id, auth.uid()));
      CREATE POLICY %1$s_insert ON public.%1$I FOR INSERT TO authenticated
        WITH CHECK (public.can_manage_company(company_id, auth.uid()));
      CREATE POLICY %1$s_update ON public.%1$I FOR UPDATE TO authenticated
        USING (public.can_manage_company(company_id, auth.uid()))
        WITH CHECK (public.can_manage_company(company_id, auth.uid()));
      CREATE POLICY %1$s_delete ON public.%1$I FOR DELETE TO authenticated
        USING (public.can_manage_company(company_id, auth.uid()));
    $f$, t);
  END LOOP;
END $$;

-- catalogue : modèles partagés (company_id NULL) lisibles par tous les membres
CREATE POLICY solar_module_catalog_select ON public.solar_module_catalog FOR SELECT TO authenticated
  USING (company_id IS NULL OR public.is_company_member(company_id, auth.uid()));
CREATE POLICY solar_module_catalog_insert ON public.solar_module_catalog FOR INSERT TO authenticated
  WITH CHECK (company_id IS NOT NULL AND public.can_manage_company(company_id, auth.uid()));
CREATE POLICY solar_module_catalog_update ON public.solar_module_catalog FOR UPDATE TO authenticated
  USING (company_id IS NOT NULL AND public.can_manage_company(company_id, auth.uid()))
  WITH CHECK (company_id IS NOT NULL AND public.can_manage_company(company_id, auth.uid()));
CREATE POLICY solar_module_catalog_delete ON public.solar_module_catalog FOR DELETE TO authenticated
  USING (company_id IS NOT NULL AND public.can_manage_company(company_id, auth.uid()));

-- ============ TRIGGERS updated_at ============
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'solar_models','solar_buildings','solar_roof_planes','solar_obstacles',
    'solar_zones','solar_module_catalog','solar_arrays','solar_modules_placed','solar_measurements'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %1$s_touch BEFORE UPDATE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()', t);
  END LOOP;
END $$;

-- ============ CATALOGUE PARTAGE (dimensions publiques constructeur) ============
INSERT INTO public.solar_module_catalog (company_id, manufacturer, reference, power_wc, width_mm, height_mm, thickness_mm, technology, efficiency_pct, cell_count, bypass_diodes)
VALUES
  (NULL, 'DualSun', 'FLASH 500 Half-Cut Glass-Glass', 500, 1134, 1993, 35, 'monocristallin_topcon', 22.1, 132, 3),
  (NULL, 'Trina Solar', 'Vertex S+ TSM-NEG9R.28 450', 450, 1134, 1762, 30, 'monocristallin_topcon', 22.5, 108, 3),
  (NULL, 'Longi', 'Hi-MO 6 LR5-54HTH 430', 430, 1134, 1722, 30, 'monocristallin_hpbc', 22.0, 108, 3),
  (NULL, 'JA Solar', 'JAM54D40 440/LB', 440, 1134, 1762, 30, 'monocristallin_bifacial', 22.0, 108, 3),
  (NULL, 'Sunpower', 'Maxeon 6 AC 435', 435, 1042, 1872, 40, 'monocristallin_ibc', 22.3, 66, NULL),
  (NULL, 'Recom', 'Black Tiger RCM-410', 410, 1134, 1722, 30, 'monocristallin', 21.0, 108, 3);
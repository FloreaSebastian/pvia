
-- 1. solar_models : géoréférencement, CRS, version géométrique
ALTER TABLE public.solar_models
  ADD COLUMN IF NOT EXISTS origin_altitude_m numeric,
  ADD COLUMN IF NOT EXISTS altitude_source text,
  ADD COLUMN IF NOT EXISTS source_crs text NOT NULL DEFAULT 'EPSG:4326',
  ADD COLUMN IF NOT EXISTS working_crs text NOT NULL DEFAULT 'LOCAL_ENU',
  ADD COLUMN IF NOT EXISTS projected_crs text,
  ADD COLUMN IF NOT EXISTS geometry_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS geometry_hash text,
  ADD COLUMN IF NOT EXISTS location_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS location_confirmed_by uuid;

-- 2. provenance générique
CREATE TABLE IF NOT EXISTS public.solar_provenance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  model_id uuid NOT NULL REFERENCES public.solar_models(id) ON DELETE CASCADE,
  entity_kind text NOT NULL,
  entity_id uuid NOT NULL,
  attribute text NOT NULL DEFAULT 'geometry',
  source_type text NOT NULL DEFAULT 'MANUAL',
  source_provider text,
  source_dataset text,
  source_date date,
  source_ref text,
  confidence text NOT NULL DEFAULT 'estimated',
  verification_status text NOT NULL DEFAULT 'unverified',
  verification_method text,
  verified_at timestamptz,
  verified_by uuid,
  field_measurement_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (model_id, entity_kind, entity_id, attribute)
);
CREATE INDEX IF NOT EXISTS idx_solar_provenance_model ON public.solar_provenance(model_id);
CREATE INDEX IF NOT EXISTS idx_solar_provenance_entity ON public.solar_provenance(entity_kind, entity_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.solar_provenance TO authenticated;
GRANT ALL ON public.solar_provenance TO service_role;
ALTER TABLE public.solar_provenance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "solar_provenance_select" ON public.solar_provenance
  FOR SELECT TO authenticated USING (public.is_company_member(company_id, auth.uid()));
CREATE POLICY "solar_provenance_insert" ON public.solar_provenance
  FOR INSERT TO authenticated WITH CHECK (public.can_write_company_member(company_id, auth.uid()));
CREATE POLICY "solar_provenance_update" ON public.solar_provenance
  FOR UPDATE TO authenticated USING (public.can_write_company_member(company_id, auth.uid()))
  WITH CHECK (public.can_write_company_member(company_id, auth.uid()));
CREATE POLICY "solar_provenance_delete" ON public.solar_provenance
  FOR DELETE TO authenticated USING (public.can_write_company_member(company_id, auth.uid()));

CREATE TRIGGER solar_provenance_updated_at BEFORE UPDATE ON public.solar_provenance
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. jobs de traitement géospatial
CREATE TABLE IF NOT EXISTS public.solar_processing_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  model_id uuid NOT NULL REFERENCES public.solar_models(id) ON DELETE CASCADE,
  job_type text NOT NULL,
  status text NOT NULL DEFAULT 'QUEUED',
  idempotency_key text NOT NULL,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  progress_step integer NOT NULL DEFAULT 0,
  progress_total integer NOT NULL DEFAULT 4,
  progress_label text,
  error_message text,
  geometry_version integer,
  started_at timestamptz,
  finished_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (model_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_solar_jobs_model ON public.solar_processing_jobs(model_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.solar_processing_jobs TO authenticated;
GRANT ALL ON public.solar_processing_jobs TO service_role;
ALTER TABLE public.solar_processing_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "solar_jobs_select" ON public.solar_processing_jobs
  FOR SELECT TO authenticated USING (public.is_company_member(company_id, auth.uid()));
CREATE POLICY "solar_jobs_insert" ON public.solar_processing_jobs
  FOR INSERT TO authenticated WITH CHECK (public.can_write_company_member(company_id, auth.uid()));
CREATE POLICY "solar_jobs_update" ON public.solar_processing_jobs
  FOR UPDATE TO authenticated USING (public.can_write_company_member(company_id, auth.uid()))
  WITH CHECK (public.can_write_company_member(company_id, auth.uid()));
CREATE POLICY "solar_jobs_delete" ON public.solar_processing_jobs
  FOR DELETE TO authenticated USING (public.can_write_company_member(company_id, auth.uid()));

CREATE TRIGGER solar_jobs_updated_at BEFORE UPDATE ON public.solar_processing_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. cache des données géographiques publiques (mutualisable, aucune donnée client)
CREATE TABLE IF NOT EXISTS public.solar_geo_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key text NOT NULL UNIQUE,
  provider text NOT NULL,
  dataset text NOT NULL,
  dataset_version text,
  crs text,
  resolution_m numeric,
  bbox jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  attribution text,
  license text,
  source_date date,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_solar_geo_cache_expiry ON public.solar_geo_cache(expires_at);

GRANT SELECT, INSERT, UPDATE ON public.solar_geo_cache TO authenticated;
GRANT ALL ON public.solar_geo_cache TO service_role;
ALTER TABLE public.solar_geo_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "solar_geo_cache_select" ON public.solar_geo_cache
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "solar_geo_cache_insert" ON public.solar_geo_cache
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "solar_geo_cache_update" ON public.solar_geo_cache
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER solar_geo_cache_updated_at BEFORE UPDATE ON public.solar_geo_cache
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5. cotes : estimation / mesure terrain / valeur retenue
ALTER TABLE public.solar_measurements
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'autre',
  ADD COLUMN IF NOT EXISTS value_estimated numeric,
  ADD COLUMN IF NOT EXISTS value_field numeric,
  ADD COLUMN IF NOT EXISTS value_retained numeric,
  ADD COLUMN IF NOT EXISTS retained_origin text NOT NULL DEFAULT 'estimated',
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS verification_method text,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_by uuid,
  ADD COLUMN IF NOT EXISTS geometry_version integer;

-- 6. géométrie source vs géométrie corrigée
ALTER TABLE public.solar_buildings
  ADD COLUMN IF NOT EXISTS source_geometry jsonb,
  ADD COLUMN IF NOT EXISTS user_geometry jsonb,
  ADD COLUMN IF NOT EXISTS terrain jsonb;

ALTER TABLE public.solar_roof_planes
  ADD COLUMN IF NOT EXISTS source_geometry jsonb,
  ADD COLUMN IF NOT EXISTS detection jsonb,
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'unverified';

ALTER TABLE public.solar_obstacles
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS detection jsonb;

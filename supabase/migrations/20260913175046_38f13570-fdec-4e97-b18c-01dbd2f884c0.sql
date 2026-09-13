-- 1. Catalogue enrichi (champs facultatifs, jamais inventés)
ALTER TABLE public.solar_module_catalog
  ADD COLUMN IF NOT EXISTS voc_v numeric,
  ADD COLUMN IF NOT EXISTS vmp_v numeric,
  ADD COLUMN IF NOT EXISTS isc_a numeric,
  ADD COLUMN IF NOT EXISTS imp_a numeric,
  ADD COLUMN IF NOT EXISTS temp_coeff_pmax_pct_per_c numeric,
  ADD COLUMN IF NOT EXISTS datasheet_source text,
  ADD COLUMN IF NOT EXISTS datasheet_date date;

-- 2. Favoris entreprise + dernier module utilisé
CREATE TABLE IF NOT EXISTS public.solar_module_favorites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  module_catalog_id uuid NOT NULL REFERENCES public.solar_module_catalog(id) ON DELETE CASCADE,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, module_catalog_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.solar_module_favorites TO authenticated;
GRANT ALL ON public.solar_module_favorites TO service_role;
ALTER TABLE public.solar_module_favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY solar_module_favorites_select ON public.solar_module_favorites
  FOR SELECT TO authenticated USING (is_company_member(company_id, auth.uid()));
CREATE POLICY solar_module_favorites_insert ON public.solar_module_favorites
  FOR INSERT TO authenticated WITH CHECK (can_write_company_member(company_id, auth.uid()));
CREATE POLICY solar_module_favorites_update ON public.solar_module_favorites
  FOR UPDATE TO authenticated USING (can_write_company_member(company_id, auth.uid()))
  WITH CHECK (can_write_company_member(company_id, auth.uid()));
CREATE POLICY solar_module_favorites_delete ON public.solar_module_favorites
  FOR DELETE TO authenticated USING (can_manage_company(company_id, auth.uid()));

CREATE TRIGGER solar_module_favorites_touch BEFORE UPDATE ON public.solar_module_favorites
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. Profils de règles d'implantation (aucune valeur imposée : tout à 0 par défaut)
CREATE TABLE IF NOT EXISTS public.solar_rules_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  name text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  eave_m numeric NOT NULL DEFAULT 0,
  ridge_m numeric NOT NULL DEFAULT 0,
  verge_m numeric NOT NULL DEFAULT 0,
  valley_m numeric NOT NULL DEFAULT 0,
  hip_m numeric NOT NULL DEFAULT 0,
  obstacle_m numeric NOT NULL DEFAULT 0,
  row_gap_m numeric NOT NULL DEFAULT 0,
  col_gap_m numeric NOT NULL DEFAULT 0,
  walkway_m numeric NOT NULL DEFAULT 0,
  is_default boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.solar_rules_profiles TO authenticated;
GRANT ALL ON public.solar_rules_profiles TO service_role;
ALTER TABLE public.solar_rules_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY solar_rules_profiles_select ON public.solar_rules_profiles
  FOR SELECT TO authenticated USING (is_company_member(company_id, auth.uid()));
CREATE POLICY solar_rules_profiles_insert ON public.solar_rules_profiles
  FOR INSERT TO authenticated WITH CHECK (can_manage_company(company_id, auth.uid()));
CREATE POLICY solar_rules_profiles_update ON public.solar_rules_profiles
  FOR UPDATE TO authenticated USING (can_manage_company(company_id, auth.uid()))
  WITH CHECK (can_manage_company(company_id, auth.uid()));
CREATE POLICY solar_rules_profiles_delete ON public.solar_rules_profiles
  FOR DELETE TO authenticated USING (can_manage_company(company_id, auth.uid()));

CREATE TRIGGER solar_rules_profiles_touch BEFORE UPDATE ON public.solar_rules_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Toute modification des distances incrémente la version : les anciens plans restent reproductibles.
CREATE OR REPLACE FUNCTION public.solar_rules_profile_bump_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (NEW.eave_m, NEW.ridge_m, NEW.verge_m, NEW.valley_m, NEW.hip_m, NEW.obstacle_m,
      NEW.row_gap_m, NEW.col_gap_m, NEW.walkway_m)
     IS DISTINCT FROM
     (OLD.eave_m, OLD.ridge_m, OLD.verge_m, OLD.valley_m, OLD.hip_m, OLD.obstacle_m,
      OLD.row_gap_m, OLD.col_gap_m, OLD.walkway_m) THEN
    NEW.version := OLD.version + 1;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER solar_rules_profiles_version BEFORE UPDATE ON public.solar_rules_profiles
  FOR EACH ROW EXECUTE FUNCTION public.solar_rules_profile_bump_version();

-- 4. Variantes d'implantation
CREATE TABLE IF NOT EXISTS public.solar_layout_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  model_id uuid NOT NULL REFERENCES public.solar_models(id) ON DELETE CASCADE,
  geometry_version integer NOT NULL,
  label text NOT NULL,
  strategy text NOT NULL,
  orientation_mode text NOT NULL DEFAULT 'auto',
  target_mode text NOT NULL DEFAULT 'max',
  target_power_kwc numeric,
  module_catalog_id uuid REFERENCES public.solar_module_catalog(id) ON DELETE SET NULL,
  rules_profile_id uuid REFERENCES public.solar_rules_profiles(id) ON DELETE SET NULL,
  rules_profile_version integer,
  rules_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  layout_engine_version text NOT NULL,
  module_count integer NOT NULL DEFAULT 0,
  power_kwc numeric NOT NULL DEFAULT 0,
  criteria jsonb NOT NULL DEFAULT '{}'::jsonb,
  modules jsonb NOT NULL DEFAULT '[]'::jsonb,
  schema_version integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS solar_layout_variants_model_idx
  ON public.solar_layout_variants (model_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.solar_layout_variants TO authenticated;
GRANT ALL ON public.solar_layout_variants TO service_role;
ALTER TABLE public.solar_layout_variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY solar_layout_variants_select ON public.solar_layout_variants
  FOR SELECT TO authenticated USING (is_company_member(company_id, auth.uid()));
CREATE POLICY solar_layout_variants_insert ON public.solar_layout_variants
  FOR INSERT TO authenticated WITH CHECK (can_manage_company(company_id, auth.uid()));
CREATE POLICY solar_layout_variants_update ON public.solar_layout_variants
  FOR UPDATE TO authenticated USING (can_manage_company(company_id, auth.uid()))
  WITH CHECK (can_manage_company(company_id, auth.uid()));
CREATE POLICY solar_layout_variants_delete ON public.solar_layout_variants
  FOR DELETE TO authenticated USING (can_manage_company(company_id, auth.uid()));

CREATE TRIGGER solar_layout_variants_touch BEFORE UPDATE ON public.solar_layout_variants
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5. Panneaux posés : état de validité + rattachement variante
ALTER TABLE public.solar_modules_placed
  ADD COLUMN IF NOT EXISTS validity_status text NOT NULL DEFAULT 'valid',
  ADD COLUMN IF NOT EXISTS validity_cause text,
  ADD COLUMN IF NOT EXISTS variant_id uuid REFERENCES public.solar_layout_variants(id) ON DELETE SET NULL;

-- 6. Profil de règles utilisé par un array (traçabilité du design)
ALTER TABLE public.solar_arrays
  ADD COLUMN IF NOT EXISTS rules_profile_id uuid REFERENCES public.solar_rules_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rules_profile_version integer,
  ADD COLUMN IF NOT EXISTS layout_engine_version text;
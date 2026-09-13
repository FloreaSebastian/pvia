
ALTER TABLE public.solar_module_favorites
  ADD COLUMN IF NOT EXISTS is_favorite boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS use_count integer NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS solar_module_favorites_company_variant_key
  ON public.solar_module_favorites (company_id, module_variant_id)
  WHERE module_variant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS solar_module_favorites_recent_idx
  ON public.solar_module_favorites (company_id, last_used_at DESC NULLS LAST);

CREATE OR REPLACE FUNCTION public.solar_catalog_touch_module(_company_id uuid, _variant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT is_company_member(_company_id, auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  INSERT INTO public.solar_module_favorites (company_id, module_variant_id, is_favorite, last_used_at, use_count)
  VALUES (_company_id, _variant_id, false, now(), 1)
  ON CONFLICT (company_id, module_variant_id) WHERE module_variant_id IS NOT NULL
  DO UPDATE SET last_used_at = now(), use_count = public.solar_module_favorites.use_count + 1, updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.solar_catalog_touch_module(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.solar_catalog_touch_module(uuid, uuid) TO authenticated;

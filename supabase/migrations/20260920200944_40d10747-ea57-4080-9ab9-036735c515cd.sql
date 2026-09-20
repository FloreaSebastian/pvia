ALTER TABLE public.solar_buildings
  ADD COLUMN IF NOT EXISTS geometry_mode text NOT NULL DEFAULT 'parametric',
  ADD COLUMN IF NOT EXISTS custom_planes jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'solar_buildings_geometry_mode_check'
  ) THEN
    ALTER TABLE public.solar_buildings
      ADD CONSTRAINT solar_buildings_geometry_mode_check
      CHECK (geometry_mode IN ('parametric', 'polygon'));
  END IF;
END $$;

COMMENT ON COLUMN public.solar_buildings.geometry_mode IS 'parametric = toiture paramétrique historique, polygon = pans dessinés (Solar Studio V2 P0-B)';
COMMENT ON COLUMN public.solar_buildings.custom_planes IS 'Contours de pans dessinés au sol (repère local ENU, mètres) : [{key,name,ring,tilt_deg,azimuth_deg,eave_height_m,margin_m,edge_margins}]';
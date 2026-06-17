
ALTER TABLE public.pv_photos
  ADD COLUMN IF NOT EXISTS reserve_id uuid NULL REFERENCES public.pv_reserves(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_pv_photos_reserve_id ON public.pv_photos(reserve_id) WHERE reserve_id IS NOT NULL;

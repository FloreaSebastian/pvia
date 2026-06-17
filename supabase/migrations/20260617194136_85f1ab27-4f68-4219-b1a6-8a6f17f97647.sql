
ALTER TABLE public.reserve_lift_item_photos
  ADD COLUMN IF NOT EXISTS file_hash text,
  ADD COLUMN IF NOT EXISTS file_size bigint,
  ADD COLUMN IF NOT EXISTS file_name text;

CREATE INDEX IF NOT EXISTS reserve_lift_item_photos_file_hash_idx
  ON public.reserve_lift_item_photos (file_hash);

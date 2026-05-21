ALTER TABLE public.pv
  ADD COLUMN IF NOT EXISTS is_field_draft boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision,
  ADD COLUMN IF NOT EXISTS field_last_saved_at timestamptz;

ALTER TABLE public.pv_photos
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'autre';

CREATE INDEX IF NOT EXISTS idx_pv_field_draft ON public.pv(company_id, is_field_draft) WHERE is_field_draft = true;
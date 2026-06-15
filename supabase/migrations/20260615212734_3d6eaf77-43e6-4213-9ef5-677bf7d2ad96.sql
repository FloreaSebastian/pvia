
ALTER TABLE public.pv
  ADD COLUMN IF NOT EXISTS processing_status text NOT NULL DEFAULT 'ok',
  ADD COLUMN IF NOT EXISTS processing_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS pdf_generation_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS photos_failed_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.pv
  ADD CONSTRAINT pv_processing_status_chk
  CHECK (processing_status IN ('ok','partial_error','failed'));
ALTER TABLE public.pv
  ADD CONSTRAINT pv_pdf_generation_status_chk
  CHECK (pdf_generation_status IN ('none','pending','ok','failed'));

ALTER TABLE public.reserve_lift_reports
  ADD COLUMN IF NOT EXISTS processing_status text NOT NULL DEFAULT 'ok',
  ADD COLUMN IF NOT EXISTS processing_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS pdf_generation_status text NOT NULL DEFAULT 'none';

ALTER TABLE public.reserve_lift_reports
  ADD CONSTRAINT rlr_processing_status_chk
  CHECK (processing_status IN ('ok','partial_error','failed'));
ALTER TABLE public.reserve_lift_reports
  ADD CONSTRAINT rlr_pdf_generation_status_chk
  CHECK (pdf_generation_status IN ('none','pending','ok','failed'));

CREATE INDEX IF NOT EXISTS pv_processing_status_idx
  ON public.pv (company_id, processing_status)
  WHERE processing_status <> 'ok';
CREATE INDEX IF NOT EXISTS rlr_processing_status_idx
  ON public.reserve_lift_reports (company_id, processing_status)
  WHERE processing_status <> 'ok';

ALTER TABLE public.reserve_lift_reports
  ADD COLUMN IF NOT EXISTS pdf_internal_url text,
  ADD COLUMN IF NOT EXISTS pdf_client_url text,
  ADD COLUMN IF NOT EXISTS pdf_internal_generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS pdf_client_generated_at timestamptz;

UPDATE public.reserve_lift_reports
   SET pdf_client_url = pdf_url,
       pdf_client_generated_at = pdf_generated_at
 WHERE pdf_client_url IS NULL
   AND pdf_url IS NOT NULL;
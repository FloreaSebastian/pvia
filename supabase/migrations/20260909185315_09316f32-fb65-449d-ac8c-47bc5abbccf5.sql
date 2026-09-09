ALTER TABLE public.technical_studies
  ADD COLUMN IF NOT EXISTS quote_status text NOT NULL DEFAULT 'to_prepare'
    CHECK (quote_status IN ('to_prepare','prepared','sent','follow_up','accepted','refused','expired')),
  ADD COLUMN IF NOT EXISTS quote_reference text,
  ADD COLUMN IF NOT EXISTS quote_amount_ht numeric(12,2),
  ADD COLUMN IF NOT EXISTS quote_amount_ttc numeric(12,2),
  ADD COLUMN IF NOT EXISTS quote_date date,
  ADD COLUMN IF NOT EXISTS quote_sent_at date,
  ADD COLUMN IF NOT EXISTS quote_expires_at date,
  ADD COLUMN IF NOT EXISTS quote_accepted_at date,
  ADD COLUMN IF NOT EXISTS quote_comment text,
  ADD COLUMN IF NOT EXISTS quote_status_updated_at timestamptz;

UPDATE public.technical_studies
   SET quote_status = decision,
       quote_accepted_at = CASE WHEN decision = 'accepted' THEN decision_at::date ELSE NULL END,
       quote_status_updated_at = COALESCE(decision_at, updated_at),
       status = CASE WHEN status IN ('accepted','refused') THEN 'sent' ELSE status END
 WHERE decision IN ('accepted','refused');

CREATE INDEX IF NOT EXISTS technical_studies_quote_status_idx
  ON public.technical_studies (company_id, quote_status);
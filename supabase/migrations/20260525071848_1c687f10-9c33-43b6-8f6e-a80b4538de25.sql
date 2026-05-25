
-- Profiles: personal onboarding fields
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS job_title text,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;

-- Companies: legal + address breakdown + branding
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS siren text,
  ADD COLUMN IF NOT EXISTS legal_form text,
  ADD COLUMN IF NOT EXISTS vat_number text,
  ADD COLUMN IF NOT EXISTS website text,
  ADD COLUMN IF NOT EXISTS address_line1 text,
  ADD COLUMN IF NOT EXISTS address_line2 text,
  ADD COLUMN IF NOT EXISTS postal_code text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS country text DEFAULT 'FR',
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_companies_siren ON public.companies(siren) WHERE siren IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_companies_siret ON public.companies(siret) WHERE siret IS NOT NULL;

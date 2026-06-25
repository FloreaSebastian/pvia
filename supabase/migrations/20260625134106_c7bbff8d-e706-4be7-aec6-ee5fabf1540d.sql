
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS company_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS company_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS company_verification_source text
    CHECK (company_verification_source IN ('manual','siret_sync','admin'));

-- Backfill: les entreprises déjà complètes (onboarding fini + SIRET/SIREN + adresse + email) sont marquées validées (source manual)
UPDATE public.companies
   SET company_verified = true,
       company_verified_at = COALESCE(company_verified_at, onboarding_completed_at, now()),
       company_verification_source = COALESCE(company_verification_source, 'manual')
 WHERE company_verified = false
   AND onboarding_completed_at IS NOT NULL
   AND name IS NOT NULL
   AND (siret IS NOT NULL OR siren IS NOT NULL)
   AND address_line1 IS NOT NULL
   AND postal_code IS NOT NULL
   AND city IS NOT NULL
   AND email IS NOT NULL;

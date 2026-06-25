
-- Add client_type and entreprise fields to clients
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS client_type text NOT NULL DEFAULT 'particulier',
  ADD COLUMN IF NOT EXISTS company_name text,
  ADD COLUMN IF NOT EXISTS siret text,
  ADD COLUMN IF NOT EXISTS siren text,
  ADD COLUMN IF NOT EXISTS vat_number text,
  ADD COLUMN IF NOT EXISTS naf_code text,
  ADD COLUMN IF NOT EXISTS contact_name text;

ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_client_type_check;
ALTER TABLE public.clients
  ADD CONSTRAINT clients_client_type_check CHECK (client_type IN ('particulier','entreprise'));

ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_siret_format_check;
ALTER TABLE public.clients
  ADD CONSTRAINT clients_siret_format_check CHECK (siret IS NULL OR siret ~ '^\d{14}$');

ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_siren_format_check;
ALTER TABLE public.clients
  ADD CONSTRAINT clients_siren_format_check CHECK (siren IS NULL OR siren ~ '^\d{9}$');

CREATE INDEX IF NOT EXISTS idx_clients_client_type ON public.clients(company_id, client_type);
CREATE INDEX IF NOT EXISTS idx_clients_siret ON public.clients(company_id, siret) WHERE siret IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_clients_siren ON public.clients(company_id, siren) WHERE siren IS NOT NULL;


-- 1) PV columns
ALTER TABLE public.pv
  ADD COLUMN IF NOT EXISTS signature_mode text CHECK (signature_mode IN ('remote','onsite')),
  ADD COLUMN IF NOT EXISTS client_identity_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS client_identity_verified_by text,
  ADD COLUMN IF NOT EXISTS client_identity_email text,
  ADD COLUMN IF NOT EXISTS client_identity_phone text,
  ADD COLUMN IF NOT EXISTS client_otp_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz;

-- 2) Lock trigger when status becomes 'signe'
CREATE OR REPLACE FUNCTION public.pv_set_locked_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'signe' AND (OLD.status IS DISTINCT FROM 'signe') AND NEW.locked_at IS NULL THEN
    NEW.locked_at := now();
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS pv_set_locked_at_trg ON public.pv;
CREATE TRIGGER pv_set_locked_at_trg
BEFORE UPDATE ON public.pv
FOR EACH ROW EXECUTE FUNCTION public.pv_set_locked_at();

-- 3) OTP table for onsite client confirmation
CREATE TABLE IF NOT EXISTS public.pv_onsite_otp (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pv_id uuid NOT NULL,
  company_id uuid NOT NULL,
  email text NOT NULL,
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pv_onsite_otp_pv_id_idx ON public.pv_onsite_otp(pv_id);
CREATE INDEX IF NOT EXISTS pv_onsite_otp_expires_idx ON public.pv_onsite_otp(expires_at);

GRANT SELECT, INSERT, UPDATE ON public.pv_onsite_otp TO authenticated;
GRANT ALL ON public.pv_onsite_otp TO service_role;

ALTER TABLE public.pv_onsite_otp ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pv_onsite_otp_select_member"
  ON public.pv_onsite_otp FOR SELECT
  TO authenticated
  USING (public.is_company_member(company_id, auth.uid()));

CREATE POLICY "pv_onsite_otp_insert_member"
  ON public.pv_onsite_otp FOR INSERT
  TO authenticated
  WITH CHECK (public.is_company_member(company_id, auth.uid()));

CREATE POLICY "pv_onsite_otp_update_member"
  ON public.pv_onsite_otp FOR UPDATE
  TO authenticated
  USING (public.is_company_member(company_id, auth.uid()))
  WITH CHECK (public.is_company_member(company_id, auth.uid()));

-- 4) Company settings : signed PV email distribution
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS pv_email_recipients text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS pv_email_cc text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS send_signed_pv_to_company boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS company_signed_email text;

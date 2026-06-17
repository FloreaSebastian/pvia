
ALTER TABLE public.reserve_lift_reports
  ADD COLUMN IF NOT EXISTS client_signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS client_signature_ip text,
  ADD COLUMN IF NOT EXISTS client_signature_user_agent text,
  ADD COLUMN IF NOT EXISTS client_signature_email text,
  ADD COLUMN IF NOT EXISTS client_signature_consent_text text,
  ADD COLUMN IF NOT EXISTS client_signature_consent_at timestamptz;

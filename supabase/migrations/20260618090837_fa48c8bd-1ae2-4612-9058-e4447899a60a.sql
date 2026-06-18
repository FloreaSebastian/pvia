
ALTER TABLE public.reserve_lift_reports
  ADD COLUMN IF NOT EXISTS signer_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS signer_name text,
  ADD COLUMN IF NOT EXISTS signer_role text,
  ADD COLUMN IF NOT EXISTS signer_email text,
  ADD COLUMN IF NOT EXISTS signer_signature text,
  ADD COLUMN IF NOT EXISTS signer_signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS validation_mode text NOT NULL DEFAULT 'remote',
  ADD COLUMN IF NOT EXISTS client_signed_on_site boolean NOT NULL DEFAULT false;

ALTER TABLE public.reserve_lift_reports
  DROP CONSTRAINT IF EXISTS rlr_validation_mode_chk;
ALTER TABLE public.reserve_lift_reports
  ADD CONSTRAINT rlr_validation_mode_chk
  CHECK (validation_mode IN ('on_site','remote'));

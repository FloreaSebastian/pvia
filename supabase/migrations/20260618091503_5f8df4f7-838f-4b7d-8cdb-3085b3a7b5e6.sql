
-- Phase 2: OTP audit link on reserve_lift_reports + backfill new intervenant fields from legacy data.

ALTER TABLE public.reserve_lift_reports
  ADD COLUMN IF NOT EXISTS client_signature_otp_id uuid NULL REFERENCES public.pv_signature_otps(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_reserve_lift_reports_client_otp
  ON public.reserve_lift_reports(client_signature_otp_id);

-- Backfill: for legacy records lacking new intervenant fields, copy from
-- technician_* / company_signature so the new PDF/export shows consistent data.
UPDATE public.reserve_lift_reports r
SET
  signer_signature   = COALESCE(r.signer_signature, r.technician_signature, r.company_signature),
  signer_name        = COALESCE(r.signer_name, r.technician_name,
                                (SELECT c.name FROM public.companies c WHERE c.id = r.company_id)),
  signer_role        = COALESCE(r.signer_role,
                                CASE WHEN r.technician_signature IS NOT NULL THEN 'technicien'
                                     WHEN r.company_signature   IS NOT NULL THEN 'directeur'
                                     ELSE NULL END),
  signer_signed_at   = COALESCE(r.signer_signed_at, r.signed_at),
  validation_mode    = COALESCE(r.validation_mode,
                                CASE WHEN r.client_signed_at IS NOT NULL
                                       AND r.client_validated_at IS NULL
                                     THEN 'on_site'
                                     ELSE 'remote' END),
  client_signed_on_site = COALESCE(r.client_signed_on_site,
                                   r.client_signature IS NOT NULL
                                   AND r.client_validated_at IS NULL)
WHERE
  r.signer_signature IS NULL
  OR r.signer_name IS NULL
  OR r.signer_signed_at IS NULL
  OR r.validation_mode IS NULL;

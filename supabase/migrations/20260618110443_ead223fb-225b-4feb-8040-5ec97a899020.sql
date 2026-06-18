-- Lot C — Reserve-lift business statuses & controlled reopening.
-- Broaden the "locked" definition so all signed-ish statuses block non-service mutations,
-- while keeping brouillon/en_cours fully editable.

CREATE OR REPLACE FUNCTION public.reserve_lift_is_locked(_report public.reserve_lift_reports)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT _report.status IN (
    'signe',
    'signee_intervenant',
    'envoyee_client',
    'client_validated',
    'client_rejected',
    'archivee'
  )
  OR _report.client_signature IS NOT NULL
  OR _report.client_validated_at IS NOT NULL
  OR _report.client_rejected_at IS NOT NULL;
$$;

COMMENT ON COLUMN public.reserve_lift_reports.status IS
  'Business status. Allowed: brouillon, en_cours, signe (legacy = signee_intervenant), signee_intervenant, envoyee_client, client_validated, client_rejected, archivee. Locked statuses block non-service mutations via reserve_lift_is_locked / reserve_lift_block_locked_changes.';

-- Column-level SELECT enforcement requires removing the table-level SELECT
-- grant; otherwise REVOKE on individual columns is shadowed by the table grant.

-- ============ company_members ============
REVOKE SELECT ON public.company_members FROM authenticated, anon;

GRANT SELECT (
  id, company_id, user_id, role, status,
  invited_email, invited_by, invite_expires_at, accepted_at,
  created_at
) ON public.company_members TO authenticated;

-- (no anon SELECT — invitations and memberships are never public)

-- ============ pv ============
REVOKE SELECT ON public.pv FROM authenticated, anon;

GRANT SELECT (
  id, company_id, owner_id, client_id, chantier_id,
  numero, type, status, reception_date, description, observations,
  client_signature, company_signature, signed_at,
  signature_mode,
  client_identity_email, client_identity_phone, client_identity_verified_at,
  client_identity_verified_by, client_otp_verified,
  client_signature_user_agent,
  consent_text, consent_at,
  reception_with_reserves,
  work_reference_type, work_reference_number, work_reference_date, work_reference_amount,
  reserve_completion_delay, reserve_due_date, reserve_lift_status,
  chantier_address, chantier_postal_code, chantier_city,
  latitude, longitude,
  pdf_url, pdf_generated_at, pdf_generation_status,
  processing_status, processing_errors, photos_failed_count,
  sent_to_client_at, sent_to_email,
  sign_token_expires_at,
  is_field_draft, field_last_saved_at,
  locked_at, created_at, updated_at
) ON public.pv TO authenticated;

-- service_role keeps full access (BYPASSRLS) — no change needed.

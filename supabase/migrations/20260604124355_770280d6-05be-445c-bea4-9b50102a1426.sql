-- 1) Restrict api_keys SELECT to admins only
DROP POLICY IF EXISTS api_keys_select ON public.api_keys;
CREATE POLICY api_keys_select ON public.api_keys
  FOR SELECT
  USING (public.is_company_admin(company_id, auth.uid()));

-- 2) Hide pv.sign_token from authenticated/anon at the column level.
--    Server functions use service_role (supabaseAdmin) for the public sign flow,
--    so they continue to work. Regular members can still read every other column.
REVOKE SELECT ON public.pv FROM authenticated;
REVOKE SELECT ON public.pv FROM anon;

GRANT SELECT (
  id, numero, type, status, description, observations, reception_date,
  client_id, chantier_id, owner_id, company_id,
  client_signature, company_signature, signed_at, signature_mode,
  reception_with_reserves, reserve_lift_status, reserve_completion_delay,
  reserve_due_date, work_reference_type, work_reference_number,
  work_reference_date, work_reference_amount,
  chantier_address, chantier_postal_code, chantier_city,
  latitude, longitude,
  pdf_url, pdf_generated_at,
  sent_to_client_at, sent_to_email,
  client_identity_verified_at, client_identity_verified_by,
  client_identity_email, client_identity_phone, client_otp_verified,
  is_field_draft, field_last_saved_at,
  locked_at, sign_token_expires_at,
  created_at, updated_at
) ON public.pv TO authenticated;
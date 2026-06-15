
-- 1) Column-level revoke on pv signing token columns
REVOKE SELECT (sign_token, sign_token_hash) ON public.pv FROM anon, authenticated;

-- 2) Lock pv_signature_otps to server-only (service_role); drop client policies
DROP POLICY IF EXISTS pv_signature_otps_select_member ON public.pv_signature_otps;
DROP POLICY IF EXISTS pv_signature_otps_insert_member ON public.pv_signature_otps;
DROP POLICY IF EXISTS pv_signature_otps_update_member ON public.pv_signature_otps;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.pv_signature_otps FROM anon, authenticated;
GRANT ALL ON public.pv_signature_otps TO service_role;

-- 3) Tighten pv UPDATE: owner path also requires active company membership
DROP POLICY IF EXISTS pv_update ON public.pv;
CREATE POLICY pv_update ON public.pv
  FOR UPDATE
  USING (
    public.can_manage_company(company_id, auth.uid())
    OR (owner_id = auth.uid() AND public.is_company_member(company_id, auth.uid()))
  )
  WITH CHECK (
    public.can_manage_company(company_id, auth.uid())
    OR (owner_id = auth.uid() AND public.is_company_member(company_id, auth.uid()))
  );

-- 4) Realtime: replace permissive policy with one that also requires the
--    subscriber to be an active member of *some* company. The underlying
--    public.notifications RLS still filters per-row by company membership.
DROP POLICY IF EXISTS authenticated_postgres_changes_only ON realtime.messages;
CREATE POLICY authenticated_postgres_changes_only ON realtime.messages
  FOR SELECT TO authenticated
  USING (
    extension = 'postgres_changes'
    AND EXISTS (
      SELECT 1 FROM public.company_members
      WHERE user_id = auth.uid() AND status = 'active'
    )
  );

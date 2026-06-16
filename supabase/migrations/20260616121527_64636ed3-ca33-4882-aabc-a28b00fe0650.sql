
-- 1) Tighten anon analytics inserts: forbid setting company_id and require user_id null
DROP POLICY IF EXISTS analytics_insert_anyone ON public.analytics_events;
CREATE POLICY analytics_insert_anon ON public.analytics_events
  FOR INSERT TO anon
  WITH CHECK (user_id IS NULL AND company_id IS NULL);
CREATE POLICY analytics_insert_authenticated ON public.analytics_events
  FOR INSERT TO authenticated
  WITH CHECK (
    (user_id IS NULL OR user_id = auth.uid())
    AND (company_id IS NULL OR public.is_company_member(company_id, auth.uid()))
  );

-- 2) Restrict sensitive columns on public.pv from client roles
REVOKE SELECT (sign_token, sign_token_hash, client_signature_ip) ON public.pv FROM anon, authenticated;
REVOKE UPDATE (sign_token, sign_token_hash, client_signature_ip) ON public.pv FROM anon, authenticated;

-- 3) Restrict invite token columns on public.company_members from client roles
REVOKE SELECT (invite_token, invite_token_hash) ON public.company_members FROM anon, authenticated;
REVOKE UPDATE (invite_token, invite_token_hash) ON public.company_members FROM anon, authenticated;

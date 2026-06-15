
-- 1) integration_calendar_tokens : drop client policies, lock to service_role
DROP POLICY IF EXISTS cal_tokens_select ON public.integration_calendar_tokens;
DROP POLICY IF EXISTS cal_tokens_insert ON public.integration_calendar_tokens;
DROP POLICY IF EXISTS cal_tokens_update ON public.integration_calendar_tokens;
DROP POLICY IF EXISTS cal_tokens_delete ON public.integration_calendar_tokens;
REVOKE ALL ON public.integration_calendar_tokens FROM anon, authenticated;
GRANT ALL ON public.integration_calendar_tokens TO service_role;

-- 2) webhooks : drop client policies, lock to service_role (secret column was exposed)
DROP POLICY IF EXISTS webhooks_select ON public.webhooks;
DROP POLICY IF EXISTS webhooks_insert ON public.webhooks;
DROP POLICY IF EXISTS webhooks_update ON public.webhooks;
DROP POLICY IF EXISTS webhooks_delete ON public.webhooks;
REVOKE ALL ON public.webhooks FROM anon, authenticated;
GRANT ALL ON public.webhooks TO service_role;

-- 3) pv.sign_token_hash : column-level revoke for client roles
REVOKE SELECT (sign_token_hash) ON public.pv FROM anon, authenticated;

-- 4) storage pv-assets : remove auth.uid() folder fallback
DROP POLICY IF EXISTS pv_assets_select_company ON storage.objects;
DROP POLICY IF EXISTS pv_assets_insert_company ON storage.objects;
DROP POLICY IF EXISTS pv_assets_update_company ON storage.objects;
DROP POLICY IF EXISTS pv_assets_delete_company ON storage.objects;

CREATE POLICY pv_assets_select_company ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'pv-assets'
    AND auth.uid() IS NOT NULL
    AND public.is_company_member(((storage.foldername(name))[1])::uuid, auth.uid())
  );

CREATE POLICY pv_assets_insert_company ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'pv-assets'
    AND auth.uid() IS NOT NULL
    AND public.can_manage_company(((storage.foldername(name))[1])::uuid, auth.uid())
  );

CREATE POLICY pv_assets_update_company ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'pv-assets'
    AND auth.uid() IS NOT NULL
    AND public.can_manage_company(((storage.foldername(name))[1])::uuid, auth.uid())
  );

CREATE POLICY pv_assets_delete_company ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'pv-assets'
    AND auth.uid() IS NOT NULL
    AND public.can_manage_company(((storage.foldername(name))[1])::uuid, auth.uid())
  );

-- 5) Realtime : restrict channel subscriptions to RLS-enforced postgres_changes
ALTER TABLE IF EXISTS realtime.messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_postgres_changes_only" ON realtime.messages;
CREATE POLICY "authenticated_postgres_changes_only" ON realtime.messages
  FOR SELECT TO authenticated
  USING (extension = 'postgres_changes');

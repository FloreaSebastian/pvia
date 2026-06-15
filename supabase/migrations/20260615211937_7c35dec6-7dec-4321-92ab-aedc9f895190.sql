
-- MT-M1: restrict email_logs admin policies to platform_admin only
DROP POLICY IF EXISTS email_logs_admin_select ON public.email_logs;
DROP POLICY IF EXISTS email_logs_admin_update ON public.email_logs;

CREATE POLICY email_logs_platform_admin_select
  ON public.email_logs FOR SELECT
  TO authenticated
  USING (public.is_platform_admin(auth.uid()));

CREATE POLICY email_logs_platform_admin_update
  ON public.email_logs FOR UPDATE
  TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

-- MT-M2: drop legacy storage policies that filter on auth.uid() instead of company_id
DROP POLICY IF EXISTS pv_assets_select_own ON storage.objects;
DROP POLICY IF EXISTS pv_assets_insert_own ON storage.objects;
DROP POLICY IF EXISTS pv_assets_update_own ON storage.objects;
DROP POLICY IF EXISTS pv_assets_delete_own ON storage.objects;

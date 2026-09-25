DROP POLICY IF EXISTS companies_insert ON public.companies;
CREATE POLICY companies_insert ON public.companies FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS solar_geo_cache_insert ON public.solar_geo_cache;
DROP POLICY IF EXISTS solar_geo_cache_select ON public.solar_geo_cache;
DROP POLICY IF EXISTS solar_geo_cache_update ON public.solar_geo_cache;
REVOKE INSERT, UPDATE, DELETE ON public.solar_geo_cache FROM authenticated, anon;
GRANT ALL ON public.solar_geo_cache TO service_role;
CREATE POLICY solar_geo_cache_admin_read ON public.solar_geo_cache FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS manufacturers_read ON public.solar_manufacturers;
CREATE POLICY manufacturers_read ON public.solar_manufacturers FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.company_members cm WHERE cm.user_id = auth.uid() AND cm.status = 'active')
         OR public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS plan_limits_select_all ON public.plan_limits;
CREATE POLICY plan_limits_select_members ON public.plan_limits FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.company_members cm WHERE cm.user_id = auth.uid() AND cm.status = 'active')
         OR public.is_platform_admin(auth.uid()));
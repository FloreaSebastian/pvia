
-- F: lecture_seule_rls_write — restrict write policies to manager roles
ALTER POLICY pv_insert ON public.pv
  WITH CHECK (public.can_manage_company(company_id, auth.uid()));

DROP POLICY IF EXISTS pv_photos_write ON public.pv_photos;
CREATE POLICY pv_photos_write ON public.pv_photos
  FOR ALL
  USING (public.can_manage_company(company_id, auth.uid()))
  WITH CHECK (public.can_manage_company(company_id, auth.uid()));

DROP POLICY IF EXISTS pv_reserves_write ON public.pv_reserves;
CREATE POLICY pv_reserves_write ON public.pv_reserves
  FOR ALL
  USING (public.can_manage_company(company_id, auth.uid()))
  WITH CHECK (public.can_manage_company(company_id, auth.uid()));

-- Supabase linter: function search_path mutable
CREATE OR REPLACE FUNCTION public.reserve_lift_is_locked(_report public.reserve_lift_reports)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT _report.status = 'signe'
      OR _report.client_signature IS NOT NULL
      OR _report.client_validated_at IS NOT NULL;
$function$;

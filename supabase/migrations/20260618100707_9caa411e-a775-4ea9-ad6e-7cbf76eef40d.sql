
-- E-01: reserve_lift_item_photos write policies require manage role
DROP POLICY IF EXISTS "members insert photos" ON public.reserve_lift_item_photos;
DROP POLICY IF EXISTS "members update photos" ON public.reserve_lift_item_photos;
DROP POLICY IF EXISTS "members delete photos" ON public.reserve_lift_item_photos;

CREATE POLICY "managers insert photos"
ON public.reserve_lift_item_photos
FOR INSERT TO authenticated
WITH CHECK (public.can_manage_company(company_id, auth.uid()));

CREATE POLICY "managers update photos"
ON public.reserve_lift_item_photos
FOR UPDATE TO authenticated
USING (public.can_manage_company(company_id, auth.uid()))
WITH CHECK (public.can_manage_company(company_id, auth.uid()));

CREATE POLICY "managers delete photos"
ON public.reserve_lift_item_photos
FOR DELETE TO authenticated
USING (public.can_manage_company(company_id, auth.uid()));

-- E-02: audit_logs SELECT restricted to managers (avoid PII leak to lecture_seule / technicien)
DROP POLICY IF EXISTS audit_logs_select_member ON public.audit_logs;

CREATE POLICY audit_logs_select_managers
ON public.audit_logs
FOR SELECT TO authenticated
USING (company_id IS NOT NULL AND public.can_manage_company(company_id, auth.uid()));

-- E-04: pv_update — owner fallback also requires manage role
DROP POLICY IF EXISTS pv_update ON public.pv;

CREATE POLICY pv_update
ON public.pv
FOR UPDATE TO authenticated
USING (
  public.can_manage_company(company_id, auth.uid())
  OR (owner_id = auth.uid() AND public.can_manage_company(company_id, auth.uid()))
)
WITH CHECK (
  public.can_manage_company(company_id, auth.uid())
  OR (owner_id = auth.uid() AND public.can_manage_company(company_id, auth.uid()))
);

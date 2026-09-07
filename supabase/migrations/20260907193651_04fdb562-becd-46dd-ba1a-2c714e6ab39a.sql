DROP POLICY IF EXISTS sc_assignments_admin_all ON public.subcontractor_assignments;

CREATE POLICY sc_assignments_company_read
  ON public.subcontractor_assignments
  FOR SELECT
  TO authenticated
  USING (public.is_company_member(company_id, auth.uid()));

CREATE POLICY sc_assignments_admin_insert
  ON public.subcontractor_assignments
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_company_admin(company_id, auth.uid()));

CREATE POLICY sc_assignments_admin_update
  ON public.subcontractor_assignments
  FOR UPDATE
  TO authenticated
  USING (public.is_company_admin(company_id, auth.uid()))
  WITH CHECK (public.is_company_admin(company_id, auth.uid()));

CREATE POLICY sc_assignments_admin_delete
  ON public.subcontractor_assignments
  FOR DELETE
  TO authenticated
  USING (public.is_company_admin(company_id, auth.uid()));
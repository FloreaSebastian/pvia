
-- Tighten companies UPDATE: add WITH CHECK so admins cannot move the row to a company they don't admin
DROP POLICY IF EXISTS companies_update ON public.companies;
CREATE POLICY companies_update ON public.companies
  FOR UPDATE
  USING (public.is_company_admin(id, auth.uid()))
  WITH CHECK (public.is_company_admin(id, auth.uid()));

-- Tighten company_members UPDATE: prevent privilege escalation
-- Only directeurs (owners) may assign/keep the 'directeur' role.
DROP POLICY IF EXISTS members_update ON public.company_members;
CREATE POLICY members_update ON public.company_members
  FOR UPDATE
  USING (public.is_company_admin(company_id, auth.uid()))
  WITH CHECK (
    public.is_company_admin(company_id, auth.uid())
    AND (
      role <> 'directeur'::company_role
      OR public.is_company_owner(company_id, auth.uid())
    )
  );

-- Allow regular company members to upload PV photos (matches pv_photos write policy)
DROP POLICY IF EXISTS pv_assets_insert_company ON storage.objects;
CREATE POLICY pv_assets_insert_company ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'pv-assets'
    AND auth.uid() IS NOT NULL
    AND public.is_company_member(((storage.foldername(name))[1])::uuid, auth.uid())
  );

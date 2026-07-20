DROP POLICY IF EXISTS members_insert ON public.company_members;
CREATE POLICY members_insert ON public.company_members
FOR INSERT TO authenticated
WITH CHECK (
  is_company_admin(company_id, auth.uid())
  AND (role <> 'directeur'::company_role OR is_company_owner(company_id, auth.uid()))
);
DROP POLICY IF EXISTS members_insert ON public.company_members;

CREATE POLICY members_insert ON public.company_members
  FOR INSERT
  WITH CHECK (is_company_admin(company_id, auth.uid()));

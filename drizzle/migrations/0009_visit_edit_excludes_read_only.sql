CREATE OR REPLACE FUNCTION public.is_company_field_member(_company_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.company_members
    WHERE company_id = _company_id AND user_id = _user_id AND status = 'active'
      AND role <> 'lecture_seule');
$$;
REVOKE ALL ON FUNCTION public.is_company_field_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_company_field_member(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_edit_technical_visit(_visit_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.technical_visits v
    WHERE v.id = _visit_id
      AND v.status NOT IN ('validee', 'archivee')
      AND public.company_has_write_access(v.company_id)
      AND (
        public.can_manage_company(v.company_id, _user_id)
        OR (v.assigned_to = _user_id AND public.is_company_field_member(v.company_id, _user_id))
      )
  );
$$;

DROP POLICY IF EXISTS tv_update ON public.technical_visits;
CREATE POLICY tv_update ON public.technical_visits FOR UPDATE TO authenticated
USING (company_has_write_access(company_id) AND (can_manage_company(company_id, auth.uid()) OR ((assigned_to = auth.uid()) AND is_company_field_member(company_id, auth.uid()))))
WITH CHECK (company_has_write_access(company_id) AND (can_manage_company(company_id, auth.uid()) OR ((assigned_to = auth.uid()) AND is_company_field_member(company_id, auth.uid()))));
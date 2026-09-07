CREATE OR REPLACE FUNCTION public.sc_membership_readable(_membership_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.subcontractor_memberships m
    JOIN public.subcontractor_users su ON su.id = m.subcontractor_user_id
    JOIN public.subcontractor_companies sc ON sc.id = m.subcontractor_company_id
    WHERE m.id = _membership_id
      AND su.user_id = auth.uid()
      AND m.status = 'active'
      AND m.revoked_at IS NULL
      AND m.suspended_at IS NULL
      AND sc.status = 'active'
  );
$$;

REVOKE ALL ON FUNCTION public.sc_membership_readable(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sc_membership_readable(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS sc_assignments_self_read ON public.subcontractor_assignments;
CREATE POLICY sc_assignments_self_read
  ON public.subcontractor_assignments
  FOR SELECT
  TO authenticated
  USING (status <> 'cancelled' AND public.sc_membership_readable(membership_id));

DROP POLICY IF EXISTS sc_messages_self_read ON public.subcontractor_messages;
CREATE POLICY sc_messages_self_read
  ON public.subcontractor_messages
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.subcontractor_assignments a
      WHERE a.id = subcontractor_messages.assignment_id
        AND a.status <> 'cancelled'
        AND public.sc_membership_readable(a.membership_id)
    )
  );
-- Invitations : lecture par les administrateurs de l'entreprise, jeton exclu
CREATE POLICY "sc_invites_admin_read" ON public.subcontractor_invites
  FOR SELECT TO authenticated
  USING (public.is_company_admin(company_id, auth.uid()));

REVOKE SELECT ON public.subcontractor_invites FROM authenticated;
GRANT SELECT (id, membership_id, company_id, email, expires_at, used_at, revoked_at, created_by, created_at)
  ON public.subcontractor_invites TO authenticated;

REVOKE EXECUTE ON FUNCTION public.is_active_subcontractor(uuid, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.is_active_subcontractor(uuid, uuid) TO authenticated, service_role;
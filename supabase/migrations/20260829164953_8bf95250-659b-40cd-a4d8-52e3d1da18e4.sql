REVOKE ALL ON FUNCTION public.can_write_company(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_write_company_member(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_write_company_admin(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_write_company(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_write_company_member(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_write_company_admin(uuid, uuid) TO authenticated, service_role;
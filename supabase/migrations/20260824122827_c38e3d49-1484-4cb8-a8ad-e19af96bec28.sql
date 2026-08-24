REVOKE ALL ON FUNCTION public.can_read_technical_visit(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_edit_technical_visit(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_technical_visit(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_edit_technical_visit(uuid, uuid) TO authenticated, service_role;
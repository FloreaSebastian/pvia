REVOKE ALL ON FUNCTION public.clients_link_identity() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.clients_link_identity() FROM anon;
REVOKE ALL ON FUNCTION public.clients_link_identity() FROM authenticated;
REVOKE ALL ON FUNCTION public.resolve_client_identity(text) FROM anon;
REVOKE ALL ON FUNCTION public.resolve_client_identity(text) FROM authenticated;
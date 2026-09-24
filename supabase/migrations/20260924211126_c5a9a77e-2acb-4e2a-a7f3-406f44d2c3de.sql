ALTER FUNCTION public.solar_layout_fingerprint(uuid, uuid) SECURITY INVOKER;
REVOKE ALL ON FUNCTION public.solar_bump_layout_version() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pv_record_quota_usage() FROM anon, authenticated, public;
REVOKE ALL ON FUNCTION public.pv_enforce_month_quota() FROM anon, authenticated, public;
REVOKE ALL ON FUNCTION public.business_month_start() FROM anon, public;
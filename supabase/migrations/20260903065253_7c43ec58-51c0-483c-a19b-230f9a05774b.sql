REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES ON public.pv_quota_ledger FROM authenticated;
REVOKE ALL ON public.pv_quota_ledger FROM anon;
GRANT SELECT ON public.pv_quota_ledger TO authenticated;
GRANT ALL ON public.pv_quota_ledger TO service_role;
-- Revoke blanket SELECT and re-grant per-column, excluding the sensitive ones.

-- WEBHOOKS: hide `secret`
REVOKE SELECT ON public.webhooks FROM authenticated, anon;
GRANT SELECT (
  id, company_id, created_by, url, events, enabled, description,
  delivery_format, last_delivery_at, last_status, failure_count,
  created_at, updated_at
) ON public.webhooks TO authenticated;
GRANT ALL ON public.webhooks TO service_role;

-- INTEGRATION_CALENDAR_TOKENS: hide `token`
REVOKE SELECT ON public.integration_calendar_tokens FROM authenticated, anon;
GRANT SELECT (
  id, company_id, created_by, name, scope, revoked_at,
  last_accessed_at, created_at
) ON public.integration_calendar_tokens TO authenticated;
GRANT ALL ON public.integration_calendar_tokens TO service_role;
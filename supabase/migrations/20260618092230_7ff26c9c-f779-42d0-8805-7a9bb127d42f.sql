
-- Make service-role-only access explicit on sensitive tables by adding
-- restrictive deny-all policies for anon/authenticated. RLS is already
-- enabled; service_role bypasses RLS so edge/server functions keep working.

-- webhooks: deny anon/authenticated entirely (managed via server functions)
CREATE POLICY "webhooks_deny_anon_auth" ON public.webhooks
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

-- client_sessions
CREATE POLICY "client_sessions_deny_anon_auth" ON public.client_sessions
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

-- integration_calendar_tokens
CREATE POLICY "integration_calendar_tokens_deny_anon_auth" ON public.integration_calendar_tokens
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

-- pv_signature_otps
CREATE POLICY "pv_signature_otps_deny_anon_auth" ON public.pv_signature_otps
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

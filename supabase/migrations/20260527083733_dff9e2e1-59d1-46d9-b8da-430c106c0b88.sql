
-- 1. Notifications: scope SELECT and UPDATE to intended recipient
DROP POLICY IF EXISTS notif_select ON public.notifications;
CREATE POLICY notif_select ON public.notifications
  FOR SELECT
  USING (
    public.is_company_member(company_id, auth.uid())
    AND (user_id = auth.uid() OR user_id IS NULL)
  );

DROP POLICY IF EXISTS notif_update ON public.notifications;
CREATE POLICY notif_update ON public.notifications
  FOR UPDATE
  USING (
    public.is_company_member(company_id, auth.uid())
    AND (user_id = auth.uid() OR user_id IS NULL)
  );

-- 2. Webhooks: restrict SELECT to admins (hides signing secrets from non-admins)
DROP POLICY IF EXISTS webhooks_select ON public.webhooks;
CREATE POLICY webhooks_select ON public.webhooks
  FOR SELECT
  USING (public.is_company_admin(company_id, auth.uid()));

-- 3. Calendar tokens: restrict SELECT to admins (hides bearer tokens from non-admins)
DROP POLICY IF EXISTS cal_tokens_select ON public.integration_calendar_tokens;
CREATE POLICY cal_tokens_select ON public.integration_calendar_tokens
  FOR SELECT
  USING (public.is_company_admin(company_id, auth.uid()));

-- 4. company_members: hide invite_token from non-admins via column-level privilege.
-- Admin/server reads still work because admin code uses service_role.
REVOKE SELECT (invite_token) ON public.company_members FROM authenticated;
REVOKE SELECT (invite_token) ON public.company_members FROM anon;

-- 5. Realtime: enable RLS on realtime.messages to block ad-hoc subscriptions.
-- The app only uses postgres_changes whose data is filtered by source-table RLS,
-- so blocking realtime.messages broadcast/presence is safe here.
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

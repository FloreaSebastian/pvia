-- Tighten realtime postgres_changes subscription to enforce that the channel topic
-- ends with a company_id the user actively belongs to.
DROP POLICY IF EXISTS authenticated_postgres_changes_only ON realtime.messages;
CREATE POLICY authenticated_postgres_changes_only
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  extension = 'postgres_changes'
  AND EXISTS (
    SELECT 1 FROM public.company_members cm
    WHERE cm.user_id = auth.uid()
      AND cm.status = 'active'
      AND realtime.topic() LIKE '%' || cm.company_id::text
  )
);

-- Restrict subscriptions SELECT to company admins/owners only so Stripe customer
-- and subscription IDs aren't readable by every active member.
DROP POLICY IF EXISTS subscriptions_select_member ON public.subscriptions;
CREATE POLICY subscriptions_select_admin
ON public.subscriptions
FOR SELECT
TO authenticated
USING (public.is_company_admin(company_id, auth.uid()));

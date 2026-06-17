-- Restrict notification update to owner only
DROP POLICY IF EXISTS notif_update ON public.notifications;
CREATE POLICY notif_update ON public.notifications
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Explicit deny-by-default writes on webhook_deliveries (service_role bypasses RLS).
-- These no-op policies document intent and ensure no future broad policy can be added by accident.
CREATE POLICY deliveries_no_insert ON public.webhook_deliveries
  FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY deliveries_no_update ON public.webhook_deliveries
  FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY deliveries_no_delete ON public.webhook_deliveries
  FOR DELETE TO authenticated USING (false);
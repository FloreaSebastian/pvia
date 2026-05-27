-- email_logs: retry support
ALTER TABLE public.email_logs
  ADD COLUMN IF NOT EXISTS retries_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_retries int NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS payload jsonb;

CREATE INDEX IF NOT EXISTS idx_email_logs_retry
  ON public.email_logs (status, next_retry_at)
  WHERE status IN ('failed','retrying');

-- webhook_deliveries: configurable max attempts
ALTER TABLE public.webhook_deliveries
  ADD COLUMN IF NOT EXISTS max_attempts int NOT NULL DEFAULT 5;

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_drain
  ON public.webhook_deliveries (status, next_attempt_at)
  WHERE status IN ('pending','retrying');

-- Allow platform admins to update / insert email_logs (cron retry helpers run via service role,
-- but admins also need to flag rows as resolved/dead from the support cockpit).
DROP POLICY IF EXISTS email_logs_admin_update ON public.email_logs;
CREATE POLICY email_logs_admin_update
  ON public.email_logs
  FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS email_logs_admin_select ON public.email_logs;
CREATE POLICY email_logs_admin_select
  ON public.email_logs
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));
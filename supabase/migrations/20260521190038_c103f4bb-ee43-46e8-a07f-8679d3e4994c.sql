CREATE TABLE IF NOT EXISTS public.analytics_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid,
  company_id uuid,
  session_id text,
  event_name text NOT NULL,
  path text,
  referrer text,
  user_agent text,
  is_pwa boolean DEFAULT false,
  props jsonb
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_occurred_at
  ON public.analytics_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_company_at
  ON public.analytics_events (company_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_event_at
  ON public.analytics_events (event_name, occurred_at DESC);

ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "analytics_insert_anyone" ON public.analytics_events;
CREATE POLICY "analytics_insert_anyone"
  ON public.analytics_events
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());

DROP POLICY IF EXISTS "analytics_select_admin" ON public.analytics_events;
CREATE POLICY "analytics_select_admin"
  ON public.analytics_events
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.cleanup_analytics_events()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.analytics_events WHERE occurred_at < now() - interval '30 days';
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-analytics-events-daily') THEN
      PERFORM cron.unschedule('cleanup-analytics-events-daily');
    END IF;
    PERFORM cron.schedule(
      'cleanup-analytics-events-daily',
      '0 4 * * *',
      $cron$SELECT public.cleanup_analytics_events();$cron$
    );
  END IF;
END
$$;
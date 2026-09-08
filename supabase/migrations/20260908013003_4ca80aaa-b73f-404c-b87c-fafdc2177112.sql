-- 1) Suivi de livraison par destinataire / canal (idempotence retry-safe)
CREATE TABLE IF NOT EXISTS public.subcontractor_document_alert_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  document_id uuid NOT NULL REFERENCES public.subcontractor_documents(id) ON DELETE CASCADE,
  milestone text NOT NULL,
  expiry_date date NOT NULL,
  user_id uuid NOT NULL,
  channel text NOT NULL DEFAULT 'inapp',
  delivered_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sc_doc_alert_delivery
  ON public.subcontractor_document_alert_deliveries (document_id, milestone, expiry_date, user_id, channel);
CREATE INDEX IF NOT EXISTS idx_sc_doc_alert_delivery_company
  ON public.subcontractor_document_alert_deliveries (company_id, delivered_at DESC);

GRANT SELECT ON public.subcontractor_document_alert_deliveries TO authenticated;
GRANT ALL ON public.subcontractor_document_alert_deliveries TO service_role;

ALTER TABLE public.subcontractor_document_alert_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sc_doc_alert_delivery_admin_read" ON public.subcontractor_document_alert_deliveries;
CREATE POLICY "sc_doc_alert_delivery_admin_read"
  ON public.subcontractor_document_alert_deliveries
  FOR SELECT TO authenticated
  USING (public.is_company_admin(company_id, auth.uid()));

-- 2) Jalon terminé seulement quand tous les destinataires ont été servis
ALTER TABLE public.subcontractor_document_alerts
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

-- 3) Journal d'exécution des tâches planifiées
CREATE TABLE IF NOT EXISTS public.cron_job_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running',
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cron_job_runs_job ON public.cron_job_runs (job_name, started_at DESC);

GRANT SELECT ON public.cron_job_runs TO authenticated;
GRANT ALL ON public.cron_job_runs TO service_role;

ALTER TABLE public.cron_job_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cron_job_runs_platform_admin_read" ON public.cron_job_runs;
CREATE POLICY "cron_job_runs_platform_admin_read"
  ON public.cron_job_runs
  FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()));
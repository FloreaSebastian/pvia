-- 1) Extension du suivi de job
ALTER TABLE public.solar_processing_jobs
  ADD COLUMN IF NOT EXISTS stage text,
  ADD COLUMN IF NOT EXISTS progress_percent integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS worker_id text,
  ADD COLUMN IF NOT EXISTS error_code text,
  ADD COLUMN IF NOT EXISTS input_hash text,
  ADD COLUMN IF NOT EXISTS result_version text,
  ADD COLUMN IF NOT EXISTS pipeline_version text,
  ADD COLUMN IF NOT EXISTS engine_version text,
  ADD COLUMN IF NOT EXISTS cancel_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS metrics jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_solar_jobs_queue
  ON public.solar_processing_jobs (status, created_at)
  WHERE status IN ('QUEUED','CLAIMED','PROCESSING');

-- 2) Résultats de traitement 3D (privés au tenant)
CREATE TABLE IF NOT EXISTS public.solar_engine_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  model_id uuid NOT NULL REFERENCES public.solar_models(id) ON DELETE CASCADE,
  job_id uuid REFERENCES public.solar_processing_jobs(id) ON DELETE SET NULL,
  result_kind text NOT NULL,
  result_schema_version text NOT NULL DEFAULT 'roof-model-v1',
  pipeline_version text,
  engine_version text,
  source_provider text,
  source_dataset text,
  source_date date,
  source_crs text,
  working_crs text,
  input_hash text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  storage_path text,
  applied_at timestamptz,
  applied_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.solar_engine_results TO authenticated;
GRANT ALL ON public.solar_engine_results TO service_role;

ALTER TABLE public.solar_engine_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "solar_engine_results_select" ON public.solar_engine_results
  FOR SELECT TO authenticated
  USING (public.is_company_member(company_id, auth.uid()));
CREATE POLICY "solar_engine_results_insert" ON public.solar_engine_results
  FOR INSERT TO authenticated
  WITH CHECK (public.can_write_company_member(company_id, auth.uid()));
CREATE POLICY "solar_engine_results_update" ON public.solar_engine_results
  FOR UPDATE TO authenticated
  USING (public.can_write_company_member(company_id, auth.uid()))
  WITH CHECK (public.can_write_company_member(company_id, auth.uid()));
CREATE POLICY "solar_engine_results_delete" ON public.solar_engine_results
  FOR DELETE TO authenticated
  USING (public.can_write_company_member(company_id, auth.uid()));

CREATE TRIGGER solar_engine_results_updated_at
  BEFORE UPDATE ON public.solar_engine_results
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_solar_engine_results_model
  ON public.solar_engine_results (model_id, created_at DESC);

-- 3) Claim atomique : un seul worker par job.
CREATE OR REPLACE FUNCTION public.solar_claim_job(
  _worker_id text,
  _job_types text[] DEFAULT NULL,
  _lease_seconds integer DEFAULT 900
)
RETURNS public.solar_processing_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_job public.solar_processing_jobs;
BEGIN
  -- Reprise des baux expirés : le job redevient éligible.
  UPDATE public.solar_processing_jobs
     SET status = 'QUEUED', worker_id = NULL, lease_expires_at = NULL
   WHERE status IN ('CLAIMED','PROCESSING')
     AND lease_expires_at IS NOT NULL
     AND lease_expires_at < now()
     AND attempt_count < max_attempts;

  SELECT * INTO v_job
    FROM public.solar_processing_jobs
   WHERE status = 'QUEUED'
     AND cancel_requested_at IS NULL
     AND (_job_types IS NULL OR job_type = ANY(_job_types))
   ORDER BY created_at
   FOR UPDATE SKIP LOCKED
   LIMIT 1;

  IF v_job.id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.solar_processing_jobs
     SET status = 'CLAIMED',
         worker_id = _worker_id,
         claimed_at = now(),
         started_at = COALESCE(started_at, now()),
         heartbeat_at = now(),
         lease_expires_at = now() + make_interval(secs => GREATEST(_lease_seconds, 60)),
         attempt_count = attempt_count + 1
   WHERE id = v_job.id
  RETURNING * INTO v_job;

  RETURN v_job;
END
$$;

REVOKE ALL ON FUNCTION public.solar_claim_job(text, text[], integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.solar_claim_job(text, text[], integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.solar_claim_job(text, text[], integer) TO service_role;

-- 4) Progression (heartbeat) — renvoie true si l'annulation a été demandée.
CREATE OR REPLACE FUNCTION public.solar_job_progress(
  _job_id uuid,
  _worker_id text,
  _stage text,
  _progress_percent integer,
  _label text DEFAULT NULL,
  _lease_seconds integer DEFAULT 900
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_cancel timestamptz;
BEGIN
  UPDATE public.solar_processing_jobs
     SET status = 'PROCESSING',
         stage = _stage,
         progress_percent = LEAST(GREATEST(COALESCE(_progress_percent, 0), 0), 100),
         progress_label = COALESCE(_label, progress_label),
         heartbeat_at = now(),
         lease_expires_at = now() + make_interval(secs => GREATEST(_lease_seconds, 60))
   WHERE id = _job_id
     AND worker_id = _worker_id
     AND status IN ('CLAIMED','PROCESSING')
  RETURNING cancel_requested_at INTO v_cancel;

  RETURN v_cancel IS NOT NULL;
END
$$;

REVOKE ALL ON FUNCTION public.solar_job_progress(uuid, text, text, integer, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.solar_job_progress(uuid, text, text, integer, text, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.solar_job_progress(uuid, text, text, integer, text, integer) TO service_role;

-- 5) Clôture d'un job (succès / échec / annulation) + dépôt du résultat.
CREATE OR REPLACE FUNCTION public.solar_job_finish(
  _job_id uuid,
  _worker_id text,
  _status text,
  _result jsonb DEFAULT '{}'::jsonb,
  _metrics jsonb DEFAULT '{}'::jsonb,
  _error_code text DEFAULT NULL,
  _error_message text DEFAULT NULL,
  _result_version text DEFAULT NULL,
  _pipeline_version text DEFAULT NULL,
  _engine_version text DEFAULT NULL,
  _retryable boolean DEFAULT false
)
RETURNS public.solar_processing_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_job public.solar_processing_jobs;
  v_status text;
BEGIN
  IF _status NOT IN ('COMPLETED','FAILED','CANCELLED') THEN
    RAISE EXCEPTION 'SOLAR_JOB_INVALID_STATUS: %', _status USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_job FROM public.solar_processing_jobs
   WHERE id = _job_id AND worker_id = _worker_id FOR UPDATE;
  IF v_job.id IS NULL THEN
    RETURN NULL;
  END IF;

  v_status := _status;
  -- Erreur temporaire et tentatives restantes : le job repart en file.
  IF _status = 'FAILED' AND _retryable AND v_job.attempt_count < v_job.max_attempts THEN
    v_status := 'QUEUED';
  END IF;

  UPDATE public.solar_processing_jobs
     SET status = v_status,
         result = CASE WHEN _status = 'COMPLETED' THEN COALESCE(_result, '{}'::jsonb) ELSE result END,
         metrics = COALESCE(_metrics, '{}'::jsonb),
         error_code = _error_code,
         error_message = left(COALESCE(_error_message, ''), 500),
         result_version = COALESCE(_result_version, result_version),
         pipeline_version = COALESCE(_pipeline_version, pipeline_version),
         engine_version = COALESCE(_engine_version, engine_version),
         progress_percent = CASE WHEN _status = 'COMPLETED' THEN 100 ELSE progress_percent END,
         finished_at = CASE WHEN v_status = 'QUEUED' THEN NULL ELSE now() END,
         worker_id = CASE WHEN v_status = 'QUEUED' THEN NULL ELSE worker_id END,
         lease_expires_at = NULL
   WHERE id = _job_id
  RETURNING * INTO v_job;

  RETURN v_job;
END
$$;

REVOKE ALL ON FUNCTION public.solar_job_finish(uuid, text, text, jsonb, jsonb, text, text, text, text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.solar_job_finish(uuid, text, text, jsonb, jsonb, text, text, text, text, text, boolean) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.solar_job_finish(uuid, text, text, jsonb, jsonb, text, text, text, text, text, boolean) TO service_role;
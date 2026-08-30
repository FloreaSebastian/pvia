-- 1. Preuve persistante et irréversible de consommation de l'essai
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS trial_started_at timestamptz;

-- Backfill prudent : toute entreprise existante a déjà eu son essai.
UPDATE public.companies
   SET trial_started_at = COALESCE(trial_ends_at - interval '14 days', created_at, now())
 WHERE trial_started_at IS NULL;

-- Les nouvelles entreprises consomment leur unique essai dès la création.
ALTER TABLE public.companies
  ALTER COLUMN trial_started_at SET DEFAULT now();

-- 2. Verrou : une fois renseigné, aucun workflow ne peut le remettre à NULL
CREATE OR REPLACE FUNCTION public.companies_lock_trial_started_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.trial_started_at := COALESCE(NEW.trial_started_at, now());
    RETURN NEW;
  END IF;
  IF OLD.trial_started_at IS NOT NULL
     AND (NEW.trial_started_at IS NULL OR NEW.trial_started_at <> OLD.trial_started_at) THEN
    NEW.trial_started_at := OLD.trial_started_at;
  END IF;
  IF NEW.trial_started_at IS NULL THEN
    NEW.trial_started_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS companies_lock_trial_started_at ON public.companies;
CREATE TRIGGER companies_lock_trial_started_at
BEFORE INSERT OR UPDATE ON public.companies
FOR EACH ROW EXECUTE FUNCTION public.companies_lock_trial_started_at();

-- 3. Éligibilité au tout premier essai (source de vérité serveur)
CREATE OR REPLACE FUNCTION public.company_trial_consumed(_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  -- Fail-closed : entreprise inconnue = essai considéré consommé.
  SELECT COALESCE(
    (SELECT trial_started_at IS NOT NULL FROM public.companies WHERE id = _company_id),
    true
  );
$$;

GRANT EXECUTE ON FUNCTION public.company_trial_consumed(uuid) TO authenticated, service_role;

-- 4. Parité SQL : un `trialing` Stripe ne rouvre pas un essai déjà consommé
CREATE OR REPLACE FUNCTION public.company_has_write_access(_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH c AS (
    SELECT id, trial_ends_at, trial_started_at, suspended_at, support_status
    FROM public.companies WHERE id = _company_id
  ), s AS (
    SELECT status, trial_end, current_period_end, cancel_at_period_end
    FROM public.subscriptions
    WHERE company_id = _company_id
    ORDER BY created_at DESC
    LIMIT 1
  )
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM c) THEN false
    WHEN (SELECT suspended_at FROM c) IS NOT NULL THEN false
    WHEN (SELECT support_status FROM c) = 'blocked' THEN false
    WHEN NOT EXISTS (SELECT 1 FROM s)
      THEN coalesce((SELECT trial_ends_at FROM c), NULL) > now()
    WHEN (SELECT status FROM s) = 'trialing'
      THEN coalesce((SELECT trial_end FROM s), NULL) > now()
       AND coalesce((SELECT trial_ends_at FROM c), NULL) > now()
    WHEN (SELECT status FROM s) = 'active'
      THEN (SELECT current_period_end FROM s) IS NOT NULL
       AND (SELECT current_period_end FROM s) > now() - interval '3 days'
    WHEN (SELECT status FROM s) = 'canceled'
      THEN coalesce((SELECT cancel_at_period_end FROM s), false)
       AND coalesce((SELECT current_period_end FROM s), NULL) > now()
    ELSE false
  END;
$$;
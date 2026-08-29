ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;

UPDATE public.companies
   SET trial_ends_at = created_at + interval '14 days'
 WHERE trial_ends_at IS NULL;

ALTER TABLE public.companies
  ALTER COLUMN trial_ends_at SET DEFAULT (now() + interval '14 days');

-- Accès en écriture : essai encore valide OU abonnement Stripe exploitable.
CREATE OR REPLACE FUNCTION public.company_has_write_access(_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH c AS (
    SELECT trial_ends_at, suspended_at, support_status
      FROM public.companies WHERE id = _company_id
  ),
  s AS (
    SELECT status, current_period_end, trial_end
      FROM public.subscriptions
     WHERE company_id = _company_id
     ORDER BY created_at DESC
     LIMIT 1
  )
  SELECT CASE
    WHEN (SELECT suspended_at FROM c) IS NOT NULL THEN false
    WHEN (SELECT support_status FROM c) = 'blocked' THEN false
    WHEN NOT EXISTS (SELECT 1 FROM s)
      THEN coalesce((SELECT trial_ends_at FROM c), now()) > now()
    WHEN (SELECT status FROM s) = 'trialing'
      THEN coalesce((SELECT trial_end FROM s), now() + interval '1 day') > now()
    WHEN (SELECT status FROM s) = 'active' THEN true
    WHEN (SELECT status FROM s) = 'canceled'
      THEN coalesce((SELECT current_period_end FROM s), now() - interval '1 day') > now()
    ELSE false
  END;
$$;
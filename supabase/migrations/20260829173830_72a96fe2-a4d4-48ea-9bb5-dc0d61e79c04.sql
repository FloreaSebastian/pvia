CREATE OR REPLACE FUNCTION public.company_has_write_access(_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH c AS (
    SELECT id, trial_ends_at, suspended_at, support_status
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
    WHEN (SELECT status FROM s) = 'active'
      THEN (SELECT current_period_end FROM s) IS NOT NULL
       AND (SELECT current_period_end FROM s) > now() - interval '3 days'
    WHEN (SELECT status FROM s) = 'canceled'
      THEN coalesce((SELECT cancel_at_period_end FROM s), false)
       AND coalesce((SELECT current_period_end FROM s), NULL) > now()
    ELSE false
  END;
$$;

REVOKE ALL ON FUNCTION public.company_has_write_access(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.company_has_write_access(uuid) TO authenticated, service_role;
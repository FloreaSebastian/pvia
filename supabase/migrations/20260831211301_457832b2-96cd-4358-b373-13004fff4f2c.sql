CREATE OR REPLACE FUNCTION public.company_has_write_access(_company_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH c AS (
    SELECT id, trial_ends_at, trial_started_at, suspended_at, support_status
    FROM public.companies WHERE id = _company_id
  ), s AS (
    -- Une entreprise peut porter plusieurs lignes (résiliation, tentative de
    -- paiement échouée, réabonnement). On retient celle qui fait autorité :
    -- droits ouverts d'abord, puis période la plus lointaine, puis la plus
    -- récente. Parité stricte avec `pickAuthoritativeSubscription` (TS).
    SELECT status, trial_end, current_period_end, cancel_at_period_end
    FROM public.subscriptions
    WHERE company_id = _company_id
    ORDER BY
      CASE status
        WHEN 'active' THEN 0
        WHEN 'trialing' THEN 0
        WHEN 'past_due' THEN 1
        WHEN 'canceled' THEN 2
        WHEN 'unpaid' THEN 3
        WHEN 'paused' THEN 3
        WHEN 'incomplete' THEN 4
        WHEN 'incomplete_expired' THEN 4
        ELSE 5
      END,
      current_period_end DESC NULLS LAST,
      created_at DESC
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
$function$;
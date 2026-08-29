CREATE OR REPLACE FUNCTION public.company_has_write_access(_company_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH c AS (
    SELECT trial_ends_at, suspended_at, support_status
      FROM public.companies WHERE id = _company_id
  ),
  s AS (
    SELECT status, current_period_end, trial_end, cancel_at_period_end
      FROM public.subscriptions
     WHERE company_id = _company_id
     ORDER BY created_at DESC
     LIMIT 1
  )
  SELECT CASE
    WHEN (SELECT suspended_at FROM c) IS NOT NULL THEN false
    WHEN (SELECT support_status FROM c) = 'blocked' THEN false
    WHEN NOT EXISTS (SELECT 1 FROM s)
      THEN coalesce((SELECT trial_ends_at FROM c), now() - interval '1 day') > now()
    WHEN (SELECT status FROM s) = 'trialing'
      THEN coalesce((SELECT trial_end FROM s), now() - interval '1 day') > now()
    WHEN (SELECT status FROM s) = 'active'
      -- `active` ne suffit pas : si la synchro Stripe est en retard, la période
      -- payée peut être terminée depuis longtemps. Tolérance de 3 jours pour ne
      -- pas casser un renouvellement normal (webhook en retard de quelques min).
      THEN coalesce((SELECT current_period_end FROM s), now() + interval '1 day')
           > now() - interval '3 days'
    WHEN (SELECT status FROM s) = 'canceled'
      THEN coalesce((SELECT cancel_at_period_end FROM s), false)
           AND coalesce((SELECT current_period_end FROM s), now() - interval '1 day') > now()
    ELSE false
  END;
$function$;

CREATE OR REPLACE FUNCTION public.get_company_pv_count_current_period(_company_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Fenêtre de quota stable : mois calendaire. Un changement de formule
  -- (nouvel abonnement Stripe, donc nouveau current_period_start) ne remet
  -- plus le compteur à zéro en milieu de mois.
  SELECT coalesce(count(*), 0)::int
    FROM public.pv
   WHERE company_id = _company_id
     AND created_at >= date_trunc('month', now());
$function$;
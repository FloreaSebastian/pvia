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
      THEN coalesce((SELECT trial_ends_at FROM c), now()) > now()
    WHEN (SELECT status FROM s) = 'trialing'
      THEN coalesce((SELECT trial_end FROM s), now() - interval '1 day') > now()
    WHEN (SELECT status FROM s) = 'active' THEN true
    WHEN (SELECT status FROM s) = 'canceled'
      THEN coalesce((SELECT cancel_at_period_end FROM s), false)
           AND coalesce((SELECT current_period_end FROM s), now() - interval '1 day') > now()
    ELSE false
  END;
$function$;

COMMENT ON FUNCTION public.company_has_write_access(uuid) IS
'Droit d''écriture métier d''une entreprise (fail-closed). Essai = companies.trial_ends_at (timestamptz, 14 jours glissants). Abonnement résilié : accès conservé UNIQUEMENT si Stripe a synchronisé cancel_at_period_end = true ET current_period_end futur.';
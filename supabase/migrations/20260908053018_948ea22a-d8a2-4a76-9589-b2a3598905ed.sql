CREATE OR REPLACE FUNCTION public.is_active_subcontractor(_company_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.subcontractor_memberships m
    JOIN public.subcontractor_users su ON su.id = m.subcontractor_user_id
    JOIN public.subcontractor_companies sc ON sc.id = m.subcontractor_company_id
    WHERE m.company_id = _company_id
      AND su.user_id = _user_id
      AND m.status = 'active'
      AND m.revoked_at IS NULL
      AND sc.status = 'active'
      AND sc.archived_at IS NULL
  )
$function$;
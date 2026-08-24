ALTER TABLE public.plan_limits ADD COLUMN IF NOT EXISTS can_technical_visits boolean NOT NULL DEFAULT false;

UPDATE public.plan_limits SET can_technical_visits = (plan IN ('pro','business','enterprise'));

CREATE OR REPLACE FUNCTION public.has_plan_feature(_company_id uuid, _feature text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _lim plan_limits;
begin
  select * into _lim from public.plan_limits where plan = public.get_company_plan(_company_id);
  if _lim is null then return false; end if;
  return case _feature
    when 'remote_sign'      then _lim.can_remote_sign
    when 'advanced_stats'   then _lim.can_advanced_stats
    when 'export_audit'     then _lim.can_export_audit
    when 'branding'         then _lim.can_branding
    when 'technical_visits' then _lim.can_technical_visits
    else false
  end;
end $function$;
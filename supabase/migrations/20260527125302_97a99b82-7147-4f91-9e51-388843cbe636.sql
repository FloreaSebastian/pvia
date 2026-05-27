-- Restrict column-level access to sensitive secret/token columns.
-- All app code accesses these via service_role (supabaseAdmin); the public
-- Data API never needs to read them.
REVOKE SELECT (secret) ON public.webhooks FROM anon, authenticated;
REVOKE SELECT (token) ON public.integration_calendar_tokens FROM anon, authenticated;

-- Fix mutable search_path on touch_reserve_lifted_at
CREATE OR REPLACE FUNCTION public.touch_reserve_lifted_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'levee' AND (OLD.status IS DISTINCT FROM 'levee') AND NEW.lifted_at IS NULL THEN
    NEW.lifted_at := now();
  END IF;
  IF NEW.status = 'validee' AND (OLD.status IS DISTINCT FROM 'validee') AND NEW.validated_at IS NULL THEN
    NEW.validated_at := now();
  END IF;
  RETURN NEW;
END;
$function$;
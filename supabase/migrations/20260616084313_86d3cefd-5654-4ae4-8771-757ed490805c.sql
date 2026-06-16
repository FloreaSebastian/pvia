CREATE OR REPLACE FUNCTION public.pv_set_locked_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'signe' AND NEW.locked_at IS NULL THEN
      NEW.locked_at := COALESCE(NEW.signed_at, now());
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status = 'signe' AND (OLD.status IS DISTINCT FROM 'signe' OR OLD.locked_at IS NULL) AND NEW.locked_at IS NULL THEN
    NEW.locked_at := COALESCE(NEW.signed_at, now());
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS tr_pv_set_locked_at ON public.pv;
CREATE TRIGGER tr_pv_set_locked_at
BEFORE INSERT OR UPDATE ON public.pv
FOR EACH ROW EXECUTE FUNCTION public.pv_set_locked_at();

DROP TRIGGER IF EXISTS tr_pv_block_locked_changes ON public.pv;
CREATE TRIGGER tr_pv_block_locked_changes
BEFORE UPDATE OR DELETE ON public.pv
FOR EACH ROW EXECUTE FUNCTION public.pv_block_locked_changes();

GRANT SELECT (processing_status, processing_errors, pdf_generation_status, photos_failed_count) ON public.pv TO authenticated;

UPDATE public.pv
SET locked_at = COALESCE(signed_at, updated_at, created_at, now())
WHERE status = 'signe'
  AND locked_at IS NULL;
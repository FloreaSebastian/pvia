CREATE OR REPLACE FUNCTION public.pv_block_locked_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'signe' THEN
      RAISE EXCEPTION 'PV_LOCKED_SIGNED' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'signe' AND OLD.locked_at IS NOT NULL THEN
    IF NEW.numero IS DISTINCT FROM OLD.numero
       OR NEW.type IS DISTINCT FROM OLD.type
       OR NEW.description IS DISTINCT FROM OLD.description
       OR NEW.observations IS DISTINCT FROM OLD.observations
       OR NEW.reception_date IS DISTINCT FROM OLD.reception_date
       OR NEW.client_id IS DISTINCT FROM OLD.client_id
       OR NEW.chantier_id IS DISTINCT FROM OLD.chantier_id
       OR NEW.client_signature IS DISTINCT FROM OLD.client_signature
       OR NEW.company_signature IS DISTINCT FROM OLD.company_signature
       OR NEW.signed_at IS DISTINCT FROM OLD.signed_at
       OR NEW.signature_mode IS DISTINCT FROM OLD.signature_mode
       OR NEW.reception_with_reserves IS DISTINCT FROM OLD.reception_with_reserves
       OR NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'PV_LOCKED_SIGNED' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$function$;
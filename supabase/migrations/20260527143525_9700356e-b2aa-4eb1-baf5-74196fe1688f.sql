
-- allow OTP without pv_id (created during PV creation flow, before PV exists)
ALTER TABLE public.pv_onsite_otp ALTER COLUMN pv_id DROP NOT NULL;

-- Lock guard: prevent UPDATE/DELETE on a signed PV, except status itself (resign metadata).
CREATE OR REPLACE FUNCTION public.pv_block_locked_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'signe' THEN
      RAISE EXCEPTION 'PV_LOCKED_SIGNED' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  -- UPDATE
  IF OLD.status = 'signe' AND OLD.locked_at IS NOT NULL THEN
    -- allow updating only pdf_url, sent_to_email, sent_to_client_at, sign_token*, reserve_lift_status, updated_at
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
$$;

DROP TRIGGER IF EXISTS pv_block_locked_changes_trg ON public.pv;
CREATE TRIGGER pv_block_locked_changes_trg
BEFORE UPDATE OR DELETE ON public.pv
FOR EACH ROW EXECUTE FUNCTION public.pv_block_locked_changes();

-- Block photo/reserve mutation on signed PV
CREATE OR REPLACE FUNCTION public.pv_child_block_locked()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _status text;
BEGIN
  SELECT status INTO _status FROM public.pv
    WHERE id = COALESCE(NEW.pv_id, OLD.pv_id);
  IF _status = 'signe' THEN
    RAISE EXCEPTION 'PV_LOCKED_SIGNED' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END
$$;

DROP TRIGGER IF EXISTS pv_photos_block_locked_trg ON public.pv_photos;
CREATE TRIGGER pv_photos_block_locked_trg
BEFORE INSERT OR UPDATE OR DELETE ON public.pv_photos
FOR EACH ROW EXECUTE FUNCTION public.pv_child_block_locked();

DROP TRIGGER IF EXISTS pv_reserves_block_locked_trg ON public.pv_reserves;
CREATE TRIGGER pv_reserves_block_locked_trg
BEFORE UPDATE OR DELETE ON public.pv_reserves
FOR EACH ROW EXECUTE FUNCTION public.pv_child_block_locked();

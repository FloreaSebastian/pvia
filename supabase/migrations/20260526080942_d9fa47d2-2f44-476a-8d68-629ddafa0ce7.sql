-- 1. Extend pv with reception/work-reference/reserve-tracking columns
ALTER TABLE public.pv
  ADD COLUMN IF NOT EXISTS reception_with_reserves boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS work_reference_type text,
  ADD COLUMN IF NOT EXISTS work_reference_number text,
  ADD COLUMN IF NOT EXISTS work_reference_date date,
  ADD COLUMN IF NOT EXISTS work_reference_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS reserve_completion_delay text,
  ADD COLUMN IF NOT EXISTS reserve_due_date date,
  ADD COLUMN IF NOT EXISTS chantier_address text,
  ADD COLUMN IF NOT EXISTS chantier_postal_code text,
  ADD COLUMN IF NOT EXISTS chantier_city text,
  ADD COLUMN IF NOT EXISTS reserve_lift_status text NOT NULL DEFAULT 'none';

-- Check constraint on work_reference_type
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pv_work_reference_type_check') THEN
    ALTER TABLE public.pv ADD CONSTRAINT pv_work_reference_type_check
      CHECK (work_reference_type IS NULL OR work_reference_type IN ('devis','bon_commande','marche','manuel'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pv_reserve_lift_status_check') THEN
    ALTER TABLE public.pv ADD CONSTRAINT pv_reserve_lift_status_check
      CHECK (reserve_lift_status IN ('none','pending','partial','completed'));
  END IF;
END $$;

-- 2. Extend pv_reserves
ALTER TABLE public.pv_reserves
  ADD COLUMN IF NOT EXISTS nature text,
  ADD COLUMN IF NOT EXISTS work_to_execute text,
  ADD COLUMN IF NOT EXISTS due_date date,
  ADD COLUMN IF NOT EXISTS lifted_at timestamptz;

-- 3. Extend chantiers
ALTER TABLE public.chantiers
  ADD COLUMN IF NOT EXISTS postal_code text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision;

-- 4. Trigger: on PV insert, if with_reserves => set reserve_lift_status='pending'
CREATE OR REPLACE FUNCTION public.pv_set_initial_lift_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.reception_with_reserves THEN
    NEW.reserve_lift_status := 'pending';
  ELSE
    NEW.reserve_lift_status := 'none';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_pv_set_initial_lift_status ON public.pv;
CREATE TRIGGER trg_pv_set_initial_lift_status
  BEFORE INSERT ON public.pv
  FOR EACH ROW EXECUTE FUNCTION public.pv_set_initial_lift_status();

-- 5. Trigger: recompute pv.reserve_lift_status after a reserve status change
CREATE OR REPLACE FUNCTION public.pv_recompute_lift_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _pv_id uuid;
  _total int;
  _lifted int;
  _new text;
BEGIN
  _pv_id := COALESCE(NEW.pv_id, OLD.pv_id);
  IF _pv_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  SELECT count(*), count(*) FILTER (WHERE status IN ('levee','validee'))
    INTO _total, _lifted
  FROM public.pv_reserves WHERE pv_id = _pv_id;

  IF _total = 0 THEN
    _new := 'none';
  ELSIF _lifted = 0 THEN
    _new := 'pending';
  ELSIF _lifted < _total THEN
    _new := 'partial';
  ELSE
    _new := 'completed';
  END IF;

  UPDATE public.pv SET reserve_lift_status = _new WHERE id = _pv_id
    AND reception_with_reserves = true
    AND reserve_lift_status IS DISTINCT FROM _new;

  -- stamp lifted_at on the reserve when it transitions to 'levee'
  IF TG_OP = 'UPDATE' AND NEW.status = 'levee' AND COALESCE(OLD.status,'') <> 'levee' THEN
    UPDATE public.pv_reserves SET lifted_at = now() WHERE id = NEW.id AND lifted_at IS NULL;
  END IF;

  RETURN COALESCE(NEW, OLD);
END
$$;

DROP TRIGGER IF EXISTS trg_pv_recompute_lift_status ON public.pv_reserves;
CREATE TRIGGER trg_pv_recompute_lift_status
  AFTER INSERT OR UPDATE OR DELETE ON public.pv_reserves
  FOR EACH ROW EXECUTE FUNCTION public.pv_recompute_lift_status();
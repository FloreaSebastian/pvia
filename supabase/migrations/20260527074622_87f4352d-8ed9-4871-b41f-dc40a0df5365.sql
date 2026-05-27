-- Add client validation columns to reserve_lift_reports
ALTER TABLE public.reserve_lift_reports
  ADD COLUMN IF NOT EXISTS client_validated_at timestamptz,
  ADD COLUMN IF NOT EXISTS client_validated_email text,
  ADD COLUMN IF NOT EXISTS client_validated_ip text;

-- Allow new statuses: brouillon, signe (kept for back-compat), signed_by_company, client_validated
-- (text column, no constraint changes required)

-- Add 'validee' tracking column on reserves
ALTER TABLE public.pv_reserves
  ADD COLUMN IF NOT EXISTS validated_at timestamptz;

-- Update trigger that maintains pv.reserve_lift_status to recognize 'validee'
CREATE OR REPLACE FUNCTION public.recompute_pv_reserve_lift_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pv_id uuid;
  v_total int;
  v_open int;
  v_validated int;
  v_status text;
BEGIN
  v_pv_id := COALESCE(NEW.pv_id, OLD.pv_id);
  IF v_pv_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE status = 'ouverte'),
         COUNT(*) FILTER (WHERE status = 'validee')
    INTO v_total, v_open, v_validated
    FROM public.pv_reserves
   WHERE pv_id = v_pv_id;

  IF v_total = 0 THEN
    v_status := 'none';
  ELSIF v_open = v_total THEN
    v_status := 'pending';
  ELSIF v_validated = v_total THEN
    v_status := 'completed';
  ELSIF v_open > 0 THEN
    v_status := 'pending';
  ELSE
    v_status := 'partial';
  END IF;

  UPDATE public.pv SET reserve_lift_status = v_status WHERE id = v_pv_id;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Mark lifted_at automatically when status flips to levee
CREATE OR REPLACE FUNCTION public.touch_reserve_lifted_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'levee' AND (OLD.status IS DISTINCT FROM 'levee') AND NEW.lifted_at IS NULL THEN
    NEW.lifted_at := now();
  END IF;
  IF NEW.status = 'validee' AND (OLD.status IS DISTINCT FROM 'validee') AND NEW.validated_at IS NULL THEN
    NEW.validated_at := now();
  END IF;
  RETURN NEW;
END;
$$;
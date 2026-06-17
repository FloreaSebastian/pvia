-- Lot A: extend pv_reserves
ALTER TABLE public.pv_reserves
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS due_date date,
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal';

-- Allow extended status values via CHECK (drop old if present, replace)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'pv_reserves' AND constraint_name = 'pv_reserves_status_check'
  ) THEN
    ALTER TABLE public.pv_reserves DROP CONSTRAINT pv_reserves_status_check;
  END IF;
END $$;

ALTER TABLE public.pv_reserves
  ADD CONSTRAINT pv_reserves_status_check
  CHECK (status IN ('ouverte','en_cours','levee','en_attente_validation','validee','rejetee'));

ALTER TABLE public.pv_reserves
  ADD CONSTRAINT pv_reserves_priority_check
  CHECK (priority IN ('low','normal','high'));

CREATE INDEX IF NOT EXISTS idx_pv_reserves_company_status ON public.pv_reserves(company_id, status);
CREATE INDEX IF NOT EXISTS idx_pv_reserves_assigned_to ON public.pv_reserves(assigned_to);
CREATE INDEX IF NOT EXISTS idx_pv_reserves_due_date ON public.pv_reserves(due_date);

-- Notify on assignment / lift / validation
CREATE OR REPLACE FUNCTION public.notify_reserve_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.assigned_to IS NOT NULL
     AND (TG_OP = 'INSERT' OR COALESCE(OLD.assigned_to::text,'') <> NEW.assigned_to::text) THEN
    INSERT INTO public.notifications(company_id, user_id, type, title, body)
    VALUES (NEW.company_id, NEW.assigned_to, 'reserve_assigned',
            'Réserve assignée',
            left(coalesce(NEW.description,''), 140));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_reserve_assignment ON public.pv_reserves;
CREATE TRIGGER trg_notify_reserve_assignment
AFTER INSERT OR UPDATE OF assigned_to ON public.pv_reserves
FOR EACH ROW EXECUTE FUNCTION public.notify_reserve_assignment();
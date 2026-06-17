
-- pv_reserves: deadline reminder tracking
ALTER TABLE public.pv_reserves
  ADD COLUMN IF NOT EXISTS last_deadline_reminder_at timestamptz,
  ADD COLUMN IF NOT EXISTS deadline_reminder_count integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_pv_reserves_due_active
  ON public.pv_reserves (due_date)
  WHERE status IN ('ouverte','en_cours','rejetee','en_attente_validation')
    AND assigned_to IS NOT NULL
    AND due_date IS NOT NULL;

-- reserve_lift_reports: client rejection fields
ALTER TABLE public.reserve_lift_reports
  ADD COLUMN IF NOT EXISTS client_rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS client_rejected_email text,
  ADD COLUMN IF NOT EXISTS client_rejected_ip text,
  ADD COLUMN IF NOT EXISTS client_rejected_reason text;

-- Trigger: when a lift is rejected by client, cascade reserve statuses to 'rejetee'
CREATE OR REPLACE FUNCTION public.cascade_lift_client_rejection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.client_rejected_at IS NOT NULL
     AND (OLD.client_rejected_at IS NULL OR OLD.client_rejected_at <> NEW.client_rejected_at) THEN
    UPDATE public.pv_reserves r
       SET status = 'rejetee'
      FROM public.reserve_lift_items i
     WHERE i.report_id = NEW.id
       AND r.id = i.reserve_id
       AND r.status <> 'rejetee';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cascade_lift_client_rejection ON public.reserve_lift_reports;
CREATE TRIGGER trg_cascade_lift_client_rejection
AFTER UPDATE ON public.reserve_lift_reports
FOR EACH ROW
EXECUTE FUNCTION public.cascade_lift_client_rejection();

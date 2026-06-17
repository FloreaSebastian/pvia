
ALTER TABLE public.reserve_lift_reports
  ADD COLUMN IF NOT EXISTS technician_signature text,
  ADD COLUMN IF NOT EXISTS technician_name text;

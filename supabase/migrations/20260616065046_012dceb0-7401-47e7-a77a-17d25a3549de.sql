ALTER TABLE public.chantier_events
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;

CREATE INDEX IF NOT EXISTS chantier_events_reminder_due_idx
  ON public.chantier_events (reminder_at)
  WHERE reminder_at IS NOT NULL AND reminder_sent_at IS NULL;
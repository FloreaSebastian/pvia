
ALTER TABLE public.chantier_events
  ADD COLUMN IF NOT EXISTS color_source text NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS resized_at timestamptz,
  ADD COLUMN IF NOT EXISTS duplicated_from_event_id uuid REFERENCES public.chantier_events(id) ON DELETE SET NULL;

ALTER TABLE public.chantier_events
  DROP CONSTRAINT IF EXISTS chantier_events_color_source_check;
ALTER TABLE public.chantier_events
  ADD CONSTRAINT chantier_events_color_source_check CHECK (color_source IN ('auto','manual'));

CREATE INDEX IF NOT EXISTS chantier_events_duplicated_from_idx
  ON public.chantier_events(duplicated_from_event_id);

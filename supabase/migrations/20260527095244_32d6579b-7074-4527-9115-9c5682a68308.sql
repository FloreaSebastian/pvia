-- Enrich support_notes for triage
ALTER TABLE public.support_notes
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_by UUID,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_support_notes_company_status ON public.support_notes(company_id, status);

-- updated_at trigger
DROP TRIGGER IF EXISTS support_notes_touch_updated_at ON public.support_notes;
CREATE TRIGGER support_notes_touch_updated_at
BEFORE UPDATE ON public.support_notes
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
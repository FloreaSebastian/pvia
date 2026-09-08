-- 1) Workflow de validation des pièces sous-traitants (additif, non destructif)
ALTER TABLE public.subcontractor_documents
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS submitted_by_subcontractor_user_id uuid REFERENCES public.subcontractor_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS review_note text;

DO $$ BEGIN
  ALTER TABLE public.subcontractor_documents
    ADD CONSTRAINT subcontractor_documents_review_status_chk
    CHECK (review_status IN ('pending_review','approved','rejected'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.subcontractor_documents
    ADD CONSTRAINT subcontractor_documents_rejection_reason_chk
    CHECK (review_status <> 'rejected' OR (rejection_reason IS NOT NULL AND length(btrim(rejection_reason)) >= 5));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_sc_documents_review
  ON public.subcontractor_documents (company_id, review_status)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_sc_documents_partner_active
  ON public.subcontractor_documents (subcontractor_company_id)
  WHERE archived_at IS NULL;

-- 2) Journal des relances partenaire (anti-spam + audit)
CREATE TABLE IF NOT EXISTS public.subcontractor_document_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  subcontractor_company_id uuid NOT NULL REFERENCES public.subcontractor_companies(id) ON DELETE CASCADE,
  doc_type public.subcontractor_document_type,
  reason text NOT NULL,
  recipients integer NOT NULL DEFAULT 0,
  sent_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.subcontractor_document_reminders TO authenticated;
GRANT ALL ON public.subcontractor_document_reminders TO service_role;

ALTER TABLE public.subcontractor_document_reminders ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Admins read partner reminders"
    ON public.subcontractor_document_reminders FOR SELECT TO authenticated
    USING (public.is_company_admin(company_id, auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_sc_doc_reminders_recent
  ON public.subcontractor_document_reminders (company_id, subcontractor_company_id, created_at DESC);
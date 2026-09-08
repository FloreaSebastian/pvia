-- =====================================================================
-- Dossier administratif & conformité des sous-traitants (additif)
-- =====================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subcontractor_document_type') THEN
    CREATE TYPE public.subcontractor_document_type AS ENUM (
      'decennale',
      'rc_pro',
      'kbis',
      'urssaf_vigilance',
      'attestation_fiscale',
      'rge',
      'qualipv',
      'qualipac',
      'qualifelec',
      'habilitation_electrique',
      'carte_btp',
      'autorisation_specifique',
      'autre'
    );
  END IF;
END$$;

-- ------------------------------------------------------------------ documents
CREATE TABLE IF NOT EXISTS public.subcontractor_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  subcontractor_company_id uuid NOT NULL REFERENCES public.subcontractor_companies(id) ON DELETE CASCADE,
  doc_type public.subcontractor_document_type NOT NULL,
  label text,
  storage_path text NOT NULL,
  original_filename text NOT NULL,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL DEFAULT 0,
  issue_date date,
  expiry_date date,
  is_required boolean NOT NULL DEFAULT true,
  is_blocking boolean NOT NULL DEFAULT false,
  notes text,
  uploaded_by uuid,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  archived_by uuid,
  replaced_by_id uuid REFERENCES public.subcontractor_documents(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sc_docs_tenant
  ON public.subcontractor_documents (company_id, subcontractor_company_id);
CREATE INDEX IF NOT EXISTS idx_sc_docs_active
  ON public.subcontractor_documents (subcontractor_company_id, doc_type)
  WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sc_docs_expiry
  ON public.subcontractor_documents (expiry_date)
  WHERE archived_at IS NULL AND expiry_date IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.subcontractor_documents TO authenticated;
GRANT ALL ON public.subcontractor_documents TO service_role;

ALTER TABLE public.subcontractor_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sc_docs_select_members" ON public.subcontractor_documents;
CREATE POLICY "sc_docs_select_members" ON public.subcontractor_documents
  FOR SELECT TO authenticated
  USING (public.is_company_member(company_id, auth.uid()));

DROP POLICY IF EXISTS "sc_docs_insert_admin" ON public.subcontractor_documents;
CREATE POLICY "sc_docs_insert_admin" ON public.subcontractor_documents
  FOR INSERT TO authenticated
  WITH CHECK (public.is_company_admin(company_id, auth.uid()));

DROP POLICY IF EXISTS "sc_docs_update_admin" ON public.subcontractor_documents;
CREATE POLICY "sc_docs_update_admin" ON public.subcontractor_documents
  FOR UPDATE TO authenticated
  USING (public.is_company_admin(company_id, auth.uid()))
  WITH CHECK (public.is_company_admin(company_id, auth.uid()));

DROP POLICY IF EXISTS "sc_docs_delete_admin" ON public.subcontractor_documents;
CREATE POLICY "sc_docs_delete_admin" ON public.subcontractor_documents
  FOR DELETE TO authenticated
  USING (public.is_company_admin(company_id, auth.uid()));

DROP TRIGGER IF EXISTS trg_sc_docs_updated_at ON public.subcontractor_documents;
CREATE TRIGGER trg_sc_docs_updated_at
  BEFORE UPDATE ON public.subcontractor_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- --------------------------------------------------------------------- règles
CREATE TABLE IF NOT EXISTS public.subcontractor_document_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  subcontractor_company_id uuid NOT NULL REFERENCES public.subcontractor_companies(id) ON DELETE CASCADE,
  doc_type public.subcontractor_document_type NOT NULL,
  is_required boolean NOT NULL DEFAULT true,
  is_blocking boolean NOT NULL DEFAULT false,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_sc_doc_rule UNIQUE (subcontractor_company_id, doc_type)
);

CREATE INDEX IF NOT EXISTS idx_sc_doc_rules_tenant
  ON public.subcontractor_document_rules (company_id, subcontractor_company_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.subcontractor_document_rules TO authenticated;
GRANT ALL ON public.subcontractor_document_rules TO service_role;

ALTER TABLE public.subcontractor_document_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sc_doc_rules_select_members" ON public.subcontractor_document_rules;
CREATE POLICY "sc_doc_rules_select_members" ON public.subcontractor_document_rules
  FOR SELECT TO authenticated
  USING (public.is_company_member(company_id, auth.uid()));

DROP POLICY IF EXISTS "sc_doc_rules_write_admin" ON public.subcontractor_document_rules;
CREATE POLICY "sc_doc_rules_write_admin" ON public.subcontractor_document_rules
  FOR ALL TO authenticated
  USING (public.is_company_admin(company_id, auth.uid()))
  WITH CHECK (public.is_company_admin(company_id, auth.uid()));

DROP TRIGGER IF EXISTS trg_sc_doc_rules_updated_at ON public.subcontractor_document_rules;
CREATE TRIGGER trg_sc_doc_rules_updated_at
  BEFORE UPDATE ON public.subcontractor_document_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------- alertes (idempotence)
CREATE TABLE IF NOT EXISTS public.subcontractor_document_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.subcontractor_documents(id) ON DELETE CASCADE,
  milestone text NOT NULL,
  expiry_date date NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  recipients integer NOT NULL DEFAULT 0,
  CONSTRAINT uq_sc_doc_alert UNIQUE (document_id, milestone, expiry_date)
);

CREATE INDEX IF NOT EXISTS idx_sc_doc_alerts_company
  ON public.subcontractor_document_alerts (company_id, sent_at DESC);

GRANT SELECT ON public.subcontractor_document_alerts TO authenticated;
GRANT ALL ON public.subcontractor_document_alerts TO service_role;

ALTER TABLE public.subcontractor_document_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sc_doc_alerts_select_members" ON public.subcontractor_document_alerts;
CREATE POLICY "sc_doc_alerts_select_members" ON public.subcontractor_document_alerts
  FOR SELECT TO authenticated
  USING (public.is_company_member(company_id, auth.uid()));

-- ------------------------------------------- dérogation d'affectation (additif)
ALTER TABLE public.subcontractor_assignments
  ADD COLUMN IF NOT EXISTS compliance_override_at timestamptz,
  ADD COLUMN IF NOT EXISTS compliance_override_by uuid,
  ADD COLUMN IF NOT EXISTS compliance_override_reason text,
  ADD COLUMN IF NOT EXISTS compliance_snapshot jsonb;

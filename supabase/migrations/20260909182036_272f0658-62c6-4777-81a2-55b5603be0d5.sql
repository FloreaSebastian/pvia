-- ============ Cahiers des charges (pré-étude avant-vente) ============

CREATE TABLE public.technical_studies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  study_type text NOT NULL CHECK (study_type IN ('photovoltaique','pac_air_air','pac_air_eau')),
  reference text NOT NULL,
  title text,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','in_progress','internal_review','completed','sent','accepted','refused','archived')),
  site_address text,
  site_postal_code text,
  site_city text,
  assigned_to uuid,
  completion_percent integer NOT NULL DEFAULT 0 CHECK (completion_percent BETWEEN 0 AND 100),
  estimate jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary text,
  review_comment text,
  submitted_at timestamptz,
  validated_at timestamptz,
  validated_by uuid,
  sent_at timestamptz,
  sent_to_email text,
  client_message text,
  decision text CHECK (decision IN ('accepted','refused')),
  decision_at timestamptz,
  decision_reason text,
  pdf_path text,
  pdf_generated_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  converted_chantier_id uuid REFERENCES public.chantiers(id) ON DELETE SET NULL,
  converted_visit_id uuid REFERENCES public.technical_visits(id) ON DELETE SET NULL,
  converted_at timestamptz,
  duplicated_from uuid REFERENCES public.technical_studies(id) ON DELETE SET NULL,
  archived_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, reference)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.technical_studies TO authenticated;
GRANT ALL ON public.technical_studies TO service_role;
ALTER TABLE public.technical_studies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "studies_select_member" ON public.technical_studies FOR SELECT TO authenticated
  USING (public.is_company_member(company_id, auth.uid()));
CREATE POLICY "studies_insert_manage" ON public.technical_studies FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_company(company_id, auth.uid()));
CREATE POLICY "studies_update_manage" ON public.technical_studies FOR UPDATE TO authenticated
  USING (public.can_manage_company(company_id, auth.uid()))
  WITH CHECK (public.can_manage_company(company_id, auth.uid()));
CREATE POLICY "studies_delete_manage" ON public.technical_studies FOR DELETE TO authenticated
  USING (public.can_manage_company(company_id, auth.uid()));

CREATE INDEX technical_studies_company_idx ON public.technical_studies (company_id, created_at DESC);
CREATE INDEX technical_studies_client_idx ON public.technical_studies (company_id, client_id);
CREATE INDEX technical_studies_status_idx ON public.technical_studies (company_id, status);

CREATE TRIGGER technical_studies_touch BEFORE UPDATE ON public.technical_studies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- Réponses ----------
CREATE TABLE public.technical_study_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  study_id uuid NOT NULL REFERENCES public.technical_studies(id) ON DELETE CASCADE,
  section_key text NOT NULL,
  field_key text NOT NULL,
  value jsonb,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (study_id, field_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.technical_study_answers TO authenticated;
GRANT ALL ON public.technical_study_answers TO service_role;
ALTER TABLE public.technical_study_answers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "study_answers_select_member" ON public.technical_study_answers FOR SELECT TO authenticated
  USING (public.is_company_member(company_id, auth.uid()));
CREATE POLICY "study_answers_write_manage" ON public.technical_study_answers FOR ALL TO authenticated
  USING (public.can_manage_company(company_id, auth.uid()))
  WITH CHECK (public.can_manage_company(company_id, auth.uid()));

CREATE INDEX technical_study_answers_study_idx ON public.technical_study_answers (study_id);

CREATE TRIGGER technical_study_answers_touch BEFORE UPDATE ON public.technical_study_answers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- Documents & photos ----------
CREATE TABLE public.technical_study_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  study_id uuid NOT NULL REFERENCES public.technical_studies(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'document' CHECK (kind IN ('photo','document')),
  category text NOT NULL DEFAULT 'autre',
  label text,
  description text,
  doc_date date,
  storage_path text NOT NULL,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL DEFAULT 0,
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.technical_study_documents TO authenticated;
GRANT ALL ON public.technical_study_documents TO service_role;
ALTER TABLE public.technical_study_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "study_docs_select_member" ON public.technical_study_documents FOR SELECT TO authenticated
  USING (public.is_company_member(company_id, auth.uid()));
CREATE POLICY "study_docs_write_manage" ON public.technical_study_documents FOR ALL TO authenticated
  USING (public.can_manage_company(company_id, auth.uid()))
  WITH CHECK (public.can_manage_company(company_id, auth.uid()));

CREATE INDEX technical_study_documents_study_idx ON public.technical_study_documents (study_id, created_at DESC);

CREATE TRIGGER technical_study_documents_touch BEFORE UPDATE ON public.technical_study_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- Notes ----------
CREATE TABLE public.technical_study_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  study_id uuid NOT NULL REFERENCES public.technical_studies(id) ON DELETE CASCADE,
  visibility text NOT NULL CHECK (visibility IN ('internal','client')),
  body text NOT NULL,
  author_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.technical_study_notes TO authenticated;
GRANT ALL ON public.technical_study_notes TO service_role;
ALTER TABLE public.technical_study_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "study_notes_select_member" ON public.technical_study_notes FOR SELECT TO authenticated
  USING (public.is_company_member(company_id, auth.uid()));
CREATE POLICY "study_notes_write_manage" ON public.technical_study_notes FOR ALL TO authenticated
  USING (public.can_manage_company(company_id, auth.uid()))
  WITH CHECK (public.can_manage_company(company_id, auth.uid()));

CREATE INDEX technical_study_notes_study_idx ON public.technical_study_notes (study_id, created_at DESC);

CREATE TRIGGER technical_study_notes_touch BEFORE UPDATE ON public.technical_study_notes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- Versions figées ----------
CREATE TABLE public.technical_study_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  study_id uuid NOT NULL REFERENCES public.technical_studies(id) ON DELETE CASCADE,
  version integer NOT NULL,
  snapshot jsonb NOT NULL,
  pdf_path text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (study_id, version)
);

GRANT SELECT, INSERT ON public.technical_study_versions TO authenticated;
GRANT ALL ON public.technical_study_versions TO service_role;
ALTER TABLE public.technical_study_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "study_versions_select_member" ON public.technical_study_versions FOR SELECT TO authenticated
  USING (public.is_company_member(company_id, auth.uid()));
CREATE POLICY "study_versions_insert_manage" ON public.technical_study_versions FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_company(company_id, auth.uid()));

CREATE INDEX technical_study_versions_study_idx ON public.technical_study_versions (study_id, version DESC);

-- ---------- Référence automatique ----------
CREATE OR REPLACE FUNCTION public.generate_study_reference(_company_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _year text := to_char(now() AT TIME ZONE 'Europe/Paris', 'YYYY');
  _next integer;
BEGIN
  SELECT COALESCE(MAX((regexp_replace(reference, '^CDC-\d{4}-', ''))::integer), 0) + 1
    INTO _next
    FROM public.technical_studies
   WHERE company_id = _company_id
     AND reference ~ ('^CDC-' || _year || '-\d+$');
  RETURN 'CDC-' || _year || '-' || lpad(_next::text, 5, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.technical_study_assign_reference()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.reference IS NULL OR NEW.reference = '' THEN
    NEW.reference := public.generate_study_reference(NEW.company_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER technical_studies_reference BEFORE INSERT ON public.technical_studies
  FOR EACH ROW EXECUTE FUNCTION public.technical_study_assign_reference();
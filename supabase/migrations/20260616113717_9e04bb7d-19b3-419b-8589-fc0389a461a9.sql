CREATE TABLE public.pv_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  pv_id uuid REFERENCES public.pv(id) ON DELETE CASCADE,
  draft_key text,
  file_url text NOT NULL,
  file_path text NOT NULL,
  file_name text NOT NULL,
  file_type text NOT NULL,
  file_size integer,
  document_type text NOT NULL DEFAULT 'autre',
  extracted_data jsonb,
  extraction_status text NOT NULL DEFAULT 'pending',
  extraction_confidence numeric,
  extraction_error text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pv_documents_company ON public.pv_documents(company_id);
CREATE INDEX idx_pv_documents_pv ON public.pv_documents(pv_id);
CREATE INDEX idx_pv_documents_draft ON public.pv_documents(company_id, draft_key) WHERE draft_key IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pv_documents TO authenticated;
GRANT ALL ON public.pv_documents TO service_role;

ALTER TABLE public.pv_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pv_documents_select_members"
  ON public.pv_documents FOR SELECT TO authenticated
  USING (public.is_company_member(company_id, auth.uid()));

CREATE POLICY "pv_documents_insert_managers"
  ON public.pv_documents FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_company(company_id, auth.uid()));

CREATE POLICY "pv_documents_update_managers"
  ON public.pv_documents FOR UPDATE TO authenticated
  USING (public.can_manage_company(company_id, auth.uid()))
  WITH CHECK (public.can_manage_company(company_id, auth.uid()));

CREATE POLICY "pv_documents_delete_admins"
  ON public.pv_documents FOR DELETE TO authenticated
  USING (public.is_company_admin(company_id, auth.uid()));

CREATE TRIGGER pv_documents_set_updated_at
  BEFORE UPDATE ON public.pv_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
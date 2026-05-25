-- Branding versioning + extended branding columns
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS email_brand_color text,
  ADD COLUMN IF NOT EXISTS pdf_brand_color text,
  ADD COLUMN IF NOT EXISTS email_signature text;

CREATE TABLE IF NOT EXISTS public.company_branding_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  settings_snapshot jsonb NOT NULL,
  label text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_company_branding_versions_company
  ON public.company_branding_versions (company_id, created_at DESC);

ALTER TABLE public.company_branding_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS branding_versions_select ON public.company_branding_versions;
CREATE POLICY branding_versions_select ON public.company_branding_versions
  FOR SELECT USING (public.is_company_member(company_id, auth.uid()));

DROP POLICY IF EXISTS branding_versions_insert ON public.company_branding_versions;
CREATE POLICY branding_versions_insert ON public.company_branding_versions
  FOR INSERT WITH CHECK (public.is_company_admin(company_id, auth.uid()));

DROP POLICY IF EXISTS branding_versions_delete ON public.company_branding_versions;
CREATE POLICY branding_versions_delete ON public.company_branding_versions
  FOR DELETE USING (public.is_company_admin(company_id, auth.uid()));
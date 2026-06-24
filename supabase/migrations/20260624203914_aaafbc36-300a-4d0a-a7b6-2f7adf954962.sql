
-- Chantier photos table (general site photos, distinct from reserve photos)
CREATE TABLE public.chantier_photos (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  chantier_id uuid NOT NULL REFERENCES public.chantiers(id) ON DELETE CASCADE,
  photo_url text,
  storage_path text NOT NULL,
  photo_type text NOT NULL CHECK (photo_type IN ('before','during','after')),
  label text,
  caption text,
  latitude numeric,
  longitude numeric,
  accuracy numeric,
  taken_at timestamptz,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  device_info jsonb,
  exif_metadata jsonb,
  file_hash text,
  file_name text,
  file_size bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chantier_photos TO authenticated;
GRANT ALL ON public.chantier_photos TO service_role;

ALTER TABLE public.chantier_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cph_select" ON public.chantier_photos FOR SELECT TO authenticated
  USING (public.is_company_member(company_id, auth.uid()));
CREATE POLICY "cph_insert" ON public.chantier_photos FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_company(company_id, auth.uid()));
CREATE POLICY "cph_update" ON public.chantier_photos FOR UPDATE TO authenticated
  USING (public.can_manage_company(company_id, auth.uid()))
  WITH CHECK (public.can_manage_company(company_id, auth.uid()));
CREATE POLICY "cph_delete" ON public.chantier_photos FOR DELETE TO authenticated
  USING (public.can_manage_company(company_id, auth.uid()));

CREATE INDEX chantier_photos_chantier_idx ON public.chantier_photos(chantier_id, photo_type, created_at DESC);

CREATE TRIGGER chantier_photos_set_updated_at
  BEFORE UPDATE ON public.chantier_photos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

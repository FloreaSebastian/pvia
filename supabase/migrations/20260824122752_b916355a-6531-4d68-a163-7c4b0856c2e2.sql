-- =====================================================================
-- Module "Visites techniques" (V1 : photovoltaïque, PAC air/air, air/eau)
-- =====================================================================

CREATE SEQUENCE IF NOT EXISTS public.technical_visit_ref_seq;

CREATE TABLE public.technical_visits (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  chantier_id uuid NOT NULL REFERENCES public.chantiers(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  reference text NOT NULL DEFAULT ('VT' || lpad(nextval('public.technical_visit_ref_seq')::text, 4, '0')),
  visit_type text NOT NULL CHECK (visit_type IN ('photovoltaique', 'pac_air_air', 'pac_air_eau')),
  status text NOT NULL DEFAULT 'planifiee'
    CHECK (status IN ('a_planifier','planifiee','en_cours','a_completer','terminee','validee','archivee')),
  assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  validated_at timestamptz,
  validated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  site_contact_name text,
  site_contact_phone text,
  site_address text,
  prep_notes text,
  completion_percent integer NOT NULL DEFAULT 0 CHECK (completion_percent BETWEEN 0 AND 100),
  calendar_event_id uuid REFERENCES public.chantier_events(id) ON DELETE SET NULL,
  idempotency_key text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX technical_visits_idempotency_idx
  ON public.technical_visits (company_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX technical_visits_company_idx ON public.technical_visits (company_id, status, scheduled_at DESC);
CREATE INDEX technical_visits_chantier_idx ON public.technical_visits (chantier_id);
CREATE INDEX technical_visits_client_idx ON public.technical_visits (client_id);
CREATE INDEX technical_visits_assigned_idx ON public.technical_visits (assigned_to);

CREATE TABLE public.technical_visit_answers (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  visit_id uuid NOT NULL REFERENCES public.technical_visits(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  section_key text NOT NULL,
  field_key text NOT NULL,
  value jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (visit_id, field_key)
);
CREATE INDEX technical_visit_answers_visit_idx ON public.technical_visit_answers (visit_id, section_key);

CREATE TABLE public.technical_visit_photos (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  visit_id uuid NOT NULL REFERENCES public.technical_visits(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  section_key text NOT NULL,
  slot_key text NOT NULL,
  storage_path text NOT NULL,
  caption text,
  comment text,
  latitude double precision,
  longitude double precision,
  accuracy double precision,
  taken_at timestamptz,
  exif_metadata jsonb,
  file_hash text,
  file_name text,
  file_size bigint,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX technical_visit_photos_visit_idx ON public.technical_visit_photos (visit_id, section_key, slot_key);

CREATE TABLE public.technical_visit_photo_skips (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  visit_id uuid NOT NULL REFERENCES public.technical_visits(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  section_key text NOT NULL,
  slot_key text NOT NULL,
  reason text NOT NULL CHECK (reason IN ('inaccessible','equipement_absent','client_absent','danger','autre')),
  justification text NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (visit_id, slot_key)
);

CREATE TABLE public.technical_visit_constraints (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  visit_id uuid NOT NULL REFERENCES public.technical_visits(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  section_key text,
  category text NOT NULL CHECK (category IN ('acces','electricite','toiture','structure','hydraulique','frigorifique','securite','client','materiel','autre')),
  level text NOT NULL DEFAULT 'information' CHECK (level IN ('information','a_verifier','important','bloquant')),
  title text NOT NULL,
  description text,
  recommendation text,
  photo_paths text[] NOT NULL DEFAULT '{}',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX technical_visit_constraints_visit_idx ON public.technical_visit_constraints (visit_id, level);

-- ------------------------- GRANTS -------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.technical_visits TO authenticated;
GRANT ALL ON public.technical_visits TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.technical_visit_answers TO authenticated;
GRANT ALL ON public.technical_visit_answers TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.technical_visit_photos TO authenticated;
GRANT ALL ON public.technical_visit_photos TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.technical_visit_photo_skips TO authenticated;
GRANT ALL ON public.technical_visit_photo_skips TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.technical_visit_constraints TO authenticated;
GRANT ALL ON public.technical_visit_constraints TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.technical_visit_ref_seq TO authenticated, service_role;

-- ------------------------- HELPERS -------------------------
CREATE OR REPLACE FUNCTION public.can_read_technical_visit(_visit_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.technical_visits v
    WHERE v.id = _visit_id AND public.is_company_member(v.company_id, _user_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.can_edit_technical_visit(_visit_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.technical_visits v
    WHERE v.id = _visit_id
      AND v.status NOT IN ('validee', 'archivee')
      AND (
        public.can_manage_company(v.company_id, _user_id)
        OR (v.assigned_to = _user_id AND public.is_company_member(v.company_id, _user_id))
      )
  );
$$;

-- ------------------------- RLS -------------------------
ALTER TABLE public.technical_visits ENABLE ROW LEVEL SECURITY;

CREATE POLICY tv_select ON public.technical_visits FOR SELECT TO authenticated
  USING (public.is_company_member(company_id, auth.uid()));
CREATE POLICY tv_insert ON public.technical_visits FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_company(company_id, auth.uid()));
CREATE POLICY tv_update ON public.technical_visits FOR UPDATE TO authenticated
  USING (
    public.can_manage_company(company_id, auth.uid())
    OR (assigned_to = auth.uid() AND status NOT IN ('validee','archivee') AND public.is_company_member(company_id, auth.uid()))
  )
  WITH CHECK (
    public.can_manage_company(company_id, auth.uid())
    OR (assigned_to = auth.uid() AND public.is_company_member(company_id, auth.uid()))
  );
CREATE POLICY tv_delete ON public.technical_visits FOR DELETE TO authenticated
  USING (public.can_manage_company(company_id, auth.uid()));

ALTER TABLE public.technical_visit_answers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tva_select ON public.technical_visit_answers FOR SELECT TO authenticated
  USING (public.is_company_member(company_id, auth.uid()));
CREATE POLICY tva_insert ON public.technical_visit_answers FOR INSERT TO authenticated
  WITH CHECK (public.can_edit_technical_visit(visit_id, auth.uid()));
CREATE POLICY tva_update ON public.technical_visit_answers FOR UPDATE TO authenticated
  USING (public.can_edit_technical_visit(visit_id, auth.uid()))
  WITH CHECK (public.can_edit_technical_visit(visit_id, auth.uid()));
CREATE POLICY tva_delete ON public.technical_visit_answers FOR DELETE TO authenticated
  USING (public.can_edit_technical_visit(visit_id, auth.uid()));

ALTER TABLE public.technical_visit_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY tvp_select ON public.technical_visit_photos FOR SELECT TO authenticated
  USING (public.is_company_member(company_id, auth.uid()));
CREATE POLICY tvp_insert ON public.technical_visit_photos FOR INSERT TO authenticated
  WITH CHECK (public.can_edit_technical_visit(visit_id, auth.uid()));
CREATE POLICY tvp_update ON public.technical_visit_photos FOR UPDATE TO authenticated
  USING (public.can_edit_technical_visit(visit_id, auth.uid()))
  WITH CHECK (public.can_edit_technical_visit(visit_id, auth.uid()));
CREATE POLICY tvp_delete ON public.technical_visit_photos FOR DELETE TO authenticated
  USING (public.can_edit_technical_visit(visit_id, auth.uid()));

ALTER TABLE public.technical_visit_photo_skips ENABLE ROW LEVEL SECURITY;
CREATE POLICY tvs_select ON public.technical_visit_photo_skips FOR SELECT TO authenticated
  USING (public.is_company_member(company_id, auth.uid()));
CREATE POLICY tvs_insert ON public.technical_visit_photo_skips FOR INSERT TO authenticated
  WITH CHECK (public.can_edit_technical_visit(visit_id, auth.uid()));
CREATE POLICY tvs_update ON public.technical_visit_photo_skips FOR UPDATE TO authenticated
  USING (public.can_edit_technical_visit(visit_id, auth.uid()))
  WITH CHECK (public.can_edit_technical_visit(visit_id, auth.uid()));
CREATE POLICY tvs_delete ON public.technical_visit_photo_skips FOR DELETE TO authenticated
  USING (public.can_edit_technical_visit(visit_id, auth.uid()));

ALTER TABLE public.technical_visit_constraints ENABLE ROW LEVEL SECURITY;
CREATE POLICY tvc_select ON public.technical_visit_constraints FOR SELECT TO authenticated
  USING (public.is_company_member(company_id, auth.uid()));
CREATE POLICY tvc_insert ON public.technical_visit_constraints FOR INSERT TO authenticated
  WITH CHECK (public.can_edit_technical_visit(visit_id, auth.uid()));
CREATE POLICY tvc_update ON public.technical_visit_constraints FOR UPDATE TO authenticated
  USING (public.can_edit_technical_visit(visit_id, auth.uid()))
  WITH CHECK (public.can_edit_technical_visit(visit_id, auth.uid()));
CREATE POLICY tvc_delete ON public.technical_visit_constraints FOR DELETE TO authenticated
  USING (public.can_edit_technical_visit(visit_id, auth.uid()));

-- ------------------------- updated_at -------------------------
CREATE TRIGGER technical_visits_set_updated_at BEFORE UPDATE ON public.technical_visits
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER technical_visit_answers_set_updated_at BEFORE UPDATE ON public.technical_visit_answers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER technical_visit_photos_set_updated_at BEFORE UPDATE ON public.technical_visit_photos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER technical_visit_photo_skips_set_updated_at BEFORE UPDATE ON public.technical_visit_photo_skips
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER technical_visit_constraints_set_updated_at BEFORE UPDATE ON public.technical_visit_constraints
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
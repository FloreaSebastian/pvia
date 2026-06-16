
-- ============================================================
-- Lot 1 + 2 + 3: smart address, chantier events/notes/documents,
-- auto-events from pv/pv_reserves
-- ============================================================

-- 1. Add smart address columns to clients
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS address_line1 text,
  ADD COLUMN IF NOT EXISTS postal_code text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision;

-- chantiers already has postal_code/city/latitude/longitude; add address_line1
ALTER TABLE public.chantiers
  ADD COLUMN IF NOT EXISTS address_line1 text;

-- 2. chantier_events table (timeline + calendar)
CREATE TABLE IF NOT EXISTS public.chantier_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  chantier_id uuid NOT NULL REFERENCES public.chantiers(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  event_type text NOT NULL DEFAULT 'remarque',
  status text NOT NULL DEFAULT 'prevu',
  start_at timestamptz,
  end_at timestamptz,
  all_day boolean NOT NULL DEFAULT false,
  assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reminder_at timestamptz,
  location text,
  color text,
  attachment_url text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chantier_events TO authenticated;
GRANT ALL ON public.chantier_events TO service_role;
ALTER TABLE public.chantier_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY ce_select ON public.chantier_events FOR SELECT TO authenticated
  USING (public.is_company_member(company_id, auth.uid()));
CREATE POLICY ce_insert ON public.chantier_events FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_company(company_id, auth.uid()));
CREATE POLICY ce_update ON public.chantier_events FOR UPDATE TO authenticated
  USING (public.can_manage_company(company_id, auth.uid()))
  WITH CHECK (public.can_manage_company(company_id, auth.uid()));
CREATE POLICY ce_delete ON public.chantier_events FOR DELETE TO authenticated
  USING (public.is_company_admin(company_id, auth.uid()));
CREATE INDEX IF NOT EXISTS chantier_events_chantier_idx ON public.chantier_events(chantier_id, start_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS chantier_events_company_start_idx ON public.chantier_events(company_id, start_at);
CREATE TRIGGER trg_chantier_events_updated BEFORE UPDATE ON public.chantier_events
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. chantier_notes
CREATE TABLE IF NOT EXISTS public.chantier_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  chantier_id uuid NOT NULL REFERENCES public.chantiers(id) ON DELETE CASCADE,
  note text NOT NULL,
  visibility text NOT NULL DEFAULT 'internal',
  priority text NOT NULL DEFAULT 'normal',
  reminder_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chantier_notes TO authenticated;
GRANT ALL ON public.chantier_notes TO service_role;
ALTER TABLE public.chantier_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY cn_select ON public.chantier_notes FOR SELECT TO authenticated
  USING (public.is_company_member(company_id, auth.uid()));
CREATE POLICY cn_insert ON public.chantier_notes FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_company(company_id, auth.uid()));
CREATE POLICY cn_update ON public.chantier_notes FOR UPDATE TO authenticated
  USING (public.can_manage_company(company_id, auth.uid()))
  WITH CHECK (public.can_manage_company(company_id, auth.uid()));
CREATE POLICY cn_delete ON public.chantier_notes FOR DELETE TO authenticated
  USING (public.is_company_admin(company_id, auth.uid()));
CREATE INDEX IF NOT EXISTS chantier_notes_chantier_idx ON public.chantier_notes(chantier_id, created_at DESC);
CREATE TRIGGER trg_chantier_notes_updated BEFORE UPDATE ON public.chantier_notes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. chantier_documents
CREATE TABLE IF NOT EXISTS public.chantier_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  chantier_id uuid NOT NULL REFERENCES public.chantiers(id) ON DELETE CASCADE,
  name text NOT NULL,
  file_url text NOT NULL,
  storage_path text,
  file_type text,
  category text NOT NULL DEFAULT 'autre',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chantier_documents TO authenticated;
GRANT ALL ON public.chantier_documents TO service_role;
ALTER TABLE public.chantier_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY cd_select ON public.chantier_documents FOR SELECT TO authenticated
  USING (public.is_company_member(company_id, auth.uid()));
CREATE POLICY cd_insert ON public.chantier_documents FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_company(company_id, auth.uid()));
CREATE POLICY cd_update ON public.chantier_documents FOR UPDATE TO authenticated
  USING (public.can_manage_company(company_id, auth.uid()))
  WITH CHECK (public.can_manage_company(company_id, auth.uid()));
CREATE POLICY cd_delete ON public.chantier_documents FOR DELETE TO authenticated
  USING (public.is_company_admin(company_id, auth.uid()));
CREATE INDEX IF NOT EXISTS chantier_documents_chantier_idx ON public.chantier_documents(chantier_id, created_at DESC);

-- 5. Auto-event triggers from PV + reserves
CREATE OR REPLACE FUNCTION public.chantier_event_from_pv()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _title text; _type text;
BEGIN
  IF NEW.chantier_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    _title := 'PV créé ' || coalesce(NEW.numero, '');
    _type := 'system_pv_created';
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'signe' AND coalesce(OLD.status,'') <> 'signe' THEN
    _title := 'PV signé ' || coalesce(NEW.numero, '');
    _type := 'system_pv_signed';
  ELSE
    RETURN NEW;
  END IF;
  INSERT INTO public.chantier_events
    (company_id, chantier_id, client_id, title, event_type, status, start_at, all_day, created_by)
  VALUES
    (NEW.company_id, NEW.chantier_id, NEW.client_id, _title, _type, 'termine', now(), false, NEW.owner_id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_chantier_event_from_pv_ins ON public.pv;
DROP TRIGGER IF EXISTS trg_chantier_event_from_pv_upd ON public.pv;
CREATE TRIGGER trg_chantier_event_from_pv_ins AFTER INSERT ON public.pv
  FOR EACH ROW EXECUTE FUNCTION public.chantier_event_from_pv();
CREATE TRIGGER trg_chantier_event_from_pv_upd AFTER UPDATE ON public.pv
  FOR EACH ROW EXECUTE FUNCTION public.chantier_event_from_pv();

CREATE OR REPLACE FUNCTION public.chantier_event_from_reserve()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _title text; _type text; _chantier uuid; _client uuid;
BEGIN
  SELECT chantier_id, client_id INTO _chantier, _client FROM public.pv WHERE id = NEW.pv_id;
  IF _chantier IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    _title := 'Réserve créée';
    _type := 'system_reserve_created';
  ELSIF TG_OP = 'UPDATE' AND NEW.status IN ('levee','validee') AND coalesce(OLD.status,'') NOT IN ('levee','validee') THEN
    _title := 'Réserve levée';
    _type := 'system_reserve_lifted';
  ELSE
    RETURN NEW;
  END IF;
  INSERT INTO public.chantier_events
    (company_id, chantier_id, client_id, title, description, event_type, status, start_at, all_day, created_by)
  VALUES
    (NEW.company_id, _chantier, _client, _title, left(coalesce(NEW.description,''),200), _type, 'termine', now(), false, NEW.owner_id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_chantier_event_from_reserve_ins ON public.pv_reserves;
DROP TRIGGER IF EXISTS trg_chantier_event_from_reserve_upd ON public.pv_reserves;
CREATE TRIGGER trg_chantier_event_from_reserve_ins AFTER INSERT ON public.pv_reserves
  FOR EACH ROW EXECUTE FUNCTION public.chantier_event_from_reserve();
CREATE TRIGGER trg_chantier_event_from_reserve_upd AFTER UPDATE ON public.pv_reserves
  FOR EACH ROW EXECUTE FUNCTION public.chantier_event_from_reserve();

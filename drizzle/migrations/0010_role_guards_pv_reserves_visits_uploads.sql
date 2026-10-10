-- Helper : membre actif ayant l'un des rôles explicitement listés.
CREATE OR REPLACE FUNCTION public.has_company_role(_company_id uuid, _user_id uuid, _roles text[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.company_members
    WHERE company_id = _company_id AND user_id = _user_id AND status = 'active'
      AND role::text = ANY(_roles));
$$;
REVOKE ALL ON FUNCTION public.has_company_role(uuid, uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_company_role(uuid, uuid, text[]) TO authenticated, service_role;

-- D. Écriture « membre » (photos PV, fichiers pv-assets) : liste explicite, lecture_seule exclue.
CREATE OR REPLACE FUNCTION public.can_write_company_member(_company_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.has_company_role(_company_id, _user_id,
           ARRAY['directeur','responsable_exploitation','conducteur_travaux','assistant_admin','technicien'])
     AND public.company_has_write_access(_company_id);
$$;

-- C. Exception « affecté » réservée au technicien actif explicite (MANAGE couvre les autres rôles).
CREATE OR REPLACE FUNCTION public.can_edit_technical_visit(_visit_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.technical_visits v
    WHERE v.id = _visit_id
      AND v.status NOT IN ('validee', 'archivee')
      AND public.company_has_write_access(v.company_id)
      AND (
        public.can_manage_company(v.company_id, _user_id)
        OR (v.assigned_to = _user_id AND public.has_company_role(v.company_id, _user_id, ARRAY['technicien']))
      )
  );
$$;

COMMENT ON FUNCTION public.is_company_field_member(uuid, uuid) IS 'DEPRECATED: replaced by has_company_role with an explicit role list';

DROP POLICY IF EXISTS tv_update ON public.technical_visits;
CREATE POLICY tv_update ON public.technical_visits FOR UPDATE TO authenticated
USING (
  public.company_has_write_access(company_id) AND (
    public.can_manage_company(company_id, auth.uid())
    OR (assigned_to = auth.uid() AND status NOT IN ('validee','archivee')
        AND public.has_company_role(company_id, auth.uid(), ARRAY['technicien']))
  )
)
WITH CHECK (
  public.company_has_write_access(company_id) AND (
    public.can_manage_company(company_id, auth.uid())
    OR (assigned_to = auth.uid() AND status NOT IN ('validee','archivee')
        AND public.has_company_role(company_id, auth.uid(), ARRAY['technicien']))
  )
);

-- Garde colonnes : un non-gestionnaire (technicien affecté) ne modifie que la saisie terrain.
CREATE OR REPLACE FUNCTION public.technical_visit_terrain_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'authenticated' THEN RETURN NEW; END IF;
  IF public.can_manage_company(OLD.company_id, auth.uid()) THEN RETURN NEW; END IF;
  IF NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.client_id IS DISTINCT FROM OLD.client_id
     OR NEW.chantier_id IS DISTINCT FROM OLD.chantier_id
     OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
     OR NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at
     OR NEW.calendar_event_id IS DISTINCT FROM OLD.calendar_event_id
     OR NEW.validated_at IS DISTINCT FROM OLD.validated_at
     OR NEW.validated_by IS DISTINCT FROM OLD.validated_by
     OR NEW.reference IS DISTINCT FROM OLD.reference
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key THEN
    RAISE EXCEPTION 'VT_FIELD_MANAGER_ONLY';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('a_planifier','planifiee','validee','archivee') THEN
    RAISE EXCEPTION 'VT_STATUS_MANAGER_ONLY';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS technical_visits_terrain_guard ON public.technical_visits;
CREATE TRIGGER technical_visits_terrain_guard BEFORE UPDATE ON public.technical_visits
  FOR EACH ROW EXECUTE FUNCTION public.technical_visit_terrain_guard();

-- B. PV : signature/finalisation réservée aux rôles signataires, liens parents dans la même entreprise.
-- Ne s'applique qu'aux requêtes authenticated (JWT) ; les flux service_role gardent leurs propres contrôles.
CREATE OR REPLACE FUNCTION public.pv_role_tenant_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _sign boolean := false;
BEGIN
  IF coalesce(auth.role(), '') <> 'authenticated' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    RAISE EXCEPTION 'PV_TENANT_IMMUTABLE';
  END IF;
  IF NEW.client_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.client_id IS DISTINCT FROM OLD.client_id)
     AND NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = NEW.client_id AND c.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'PV_PARENT_TENANT';
  END IF;
  IF NEW.chantier_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.chantier_id IS DISTINCT FROM OLD.chantier_id)
     AND NOT EXISTS (SELECT 1 FROM public.chantiers c WHERE c.id = NEW.chantier_id AND c.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'PV_PARENT_TENANT';
  END IF;
  IF TG_OP = 'INSERT' THEN
    _sign := NEW.status IN ('signe','en_attente') OR NEW.company_signature IS NOT NULL
      OR NEW.client_signature IS NOT NULL OR NEW.signed_at IS NOT NULL OR NEW.locked_at IS NOT NULL
      OR NEW.sent_to_client_at IS NOT NULL OR NEW.sign_token IS NOT NULL OR NEW.sign_token_hash IS NOT NULL;
  ELSE
    _sign := (NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('signe','en_attente'))
      OR NEW.company_signature IS DISTINCT FROM OLD.company_signature
      OR NEW.client_signature IS DISTINCT FROM OLD.client_signature
      OR NEW.signed_at IS DISTINCT FROM OLD.signed_at
      OR NEW.locked_at IS DISTINCT FROM OLD.locked_at
      OR NEW.sent_to_client_at IS DISTINCT FROM OLD.sent_to_client_at
      OR NEW.sign_token IS DISTINCT FROM OLD.sign_token
      OR NEW.sign_token_hash IS DISTINCT FROM OLD.sign_token_hash;
  END IF;
  IF _sign AND NOT public.has_company_role(NEW.company_id, auth.uid(),
       ARRAY['directeur','responsable_exploitation','conducteur_travaux']) THEN
    RAISE EXCEPTION 'PV_SIGN_ROLE_REQUIRED';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS pv_role_tenant_guard_trg ON public.pv;
CREATE TRIGGER pv_role_tenant_guard_trg BEFORE INSERT OR UPDATE ON public.pv
  FOR EACH ROW EXECUTE FUNCTION public.pv_role_tenant_guard();

-- Réserves : parent PV dans la même entreprise ; levée/validation/rejet réservés aux signataires.
CREATE OR REPLACE FUNCTION public.pv_reserve_role_tenant_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'authenticated' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    RAISE EXCEPTION 'RESERVE_TENANT_IMMUTABLE';
  END IF;
  IF (TG_OP = 'INSERT' OR NEW.pv_id IS DISTINCT FROM OLD.pv_id)
     AND NOT EXISTS (SELECT 1 FROM public.pv p WHERE p.id = NEW.pv_id AND p.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'RESERVE_PARENT_TENANT';
  END IF;
  IF NEW.status IN ('levee','en_attente_validation','validee','rejetee')
     AND (TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status)
     AND NOT public.has_company_role(NEW.company_id, auth.uid(),
           ARRAY['directeur','responsable_exploitation','conducteur_travaux']) THEN
    RAISE EXCEPTION 'RESERVE_SIGN_ROLE_REQUIRED';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS pv_reserve_role_tenant_guard_trg ON public.pv_reserves;
CREATE TRIGGER pv_reserve_role_tenant_guard_trg BEFORE INSERT OR UPDATE ON public.pv_reserves
  FOR EACH ROW EXECUTE FUNCTION public.pv_reserve_role_tenant_guard();

-- Rapports de levée : écriture directe authenticated réservée aux signataires.
CREATE OR REPLACE FUNCTION public.reserve_lift_role_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _company uuid;
BEGIN
  IF coalesce(auth.role(), '') <> 'authenticated' THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'reserve_lift_reports' THEN
    _company := NEW.company_id;
    IF TG_OP = 'UPDATE' AND NEW.company_id IS DISTINCT FROM OLD.company_id THEN
      RAISE EXCEPTION 'LIFT_TENANT_IMMUTABLE';
    END IF;
  ELSE
    SELECT r.company_id INTO _company FROM public.reserve_lift_reports r WHERE r.id = NEW.report_id;
  END IF;
  IF _company IS NULL OR NOT public.has_company_role(_company, auth.uid(),
       ARRAY['directeur','responsable_exploitation','conducteur_travaux']) THEN
    RAISE EXCEPTION 'LIFT_SIGN_ROLE_REQUIRED';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS reserve_lift_reports_role_guard ON public.reserve_lift_reports;
CREATE TRIGGER reserve_lift_reports_role_guard BEFORE INSERT OR UPDATE ON public.reserve_lift_reports
  FOR EACH ROW EXECUTE FUNCTION public.reserve_lift_role_guard();
DROP TRIGGER IF EXISTS reserve_lift_items_role_guard ON public.reserve_lift_items;
CREATE TRIGGER reserve_lift_items_role_guard BEFORE INSERT OR UPDATE ON public.reserve_lift_items
  FOR EACH ROW EXECUTE FUNCTION public.reserve_lift_role_guard();
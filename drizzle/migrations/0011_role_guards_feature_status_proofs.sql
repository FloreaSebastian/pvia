-- 3. Exemption précise des gardes : seulement service_role (code serveur après ses
-- propres contrôles) et sessions SQL sans JWT (maintenance, cron, migrations).
-- Toute requête porteuse d'un JWT authenticated OU anon est contrôlée.
CREATE OR REPLACE FUNCTION public.guard_applies()
RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN coalesce(auth.role(), '') = 'service_role' THEN false
    WHEN coalesce(auth.role(), '') = '' AND auth.uid() IS NULL THEN false
    ELSE true
  END;
$$;
REVOKE ALL ON FUNCTION public.guard_applies() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guard_applies() TO authenticated, anon, service_role;

-- 1. Fonctionnalité « visites techniques » exigée pour toute écriture directe.
CREATE OR REPLACE FUNCTION public.can_edit_technical_visit(_visit_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.technical_visits v
    WHERE v.id = _visit_id
      AND v.status NOT IN ('validee', 'archivee')
      AND public.company_has_write_access(v.company_id)
      AND public.has_plan_feature(v.company_id, 'technical_visits')
      AND (
        public.can_manage_company(v.company_id, _user_id)
        OR (v.assigned_to = _user_id AND public.has_company_role(v.company_id, _user_id, ARRAY['technicien']))
      )
  );
$$;

DROP POLICY IF EXISTS tv_insert ON public.technical_visits;
CREATE POLICY tv_insert ON public.technical_visits FOR INSERT TO authenticated
WITH CHECK (
  public.can_write_company(company_id, auth.uid())
  AND public.has_plan_feature(company_id, 'technical_visits')
);

DROP POLICY IF EXISTS tv_update ON public.technical_visits;
CREATE POLICY tv_update ON public.technical_visits FOR UPDATE TO authenticated
USING (
  public.company_has_write_access(company_id)
  AND public.has_plan_feature(company_id, 'technical_visits')
  AND (
    public.can_manage_company(company_id, auth.uid())
    OR (assigned_to = auth.uid() AND status NOT IN ('validee','archivee')
        AND public.has_company_role(company_id, auth.uid(), ARRAY['technicien']))
  )
)
WITH CHECK (
  public.company_has_write_access(company_id)
  AND public.has_plan_feature(company_id, 'technical_visits')
  AND (
    public.can_manage_company(company_id, auth.uid())
    OR (assigned_to = auth.uid() AND status NOT IN ('validee','archivee')
        AND public.has_company_role(company_id, auth.uid(), ARRAY['technicien']))
  )
);


CREATE OR REPLACE FUNCTION public.technical_visit_terrain_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.guard_applies() THEN RETURN NEW; END IF;
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


-- 2. PV : tout changement de statut et toute pose de signature = rôle signataire ;
-- assistant n'insère qu'en brouillon ; preuves d'identité/consentement écrites
-- uniquement par les flux serveur (jamais par un JWT), et jamais modifiées sur un PV scellé.
CREATE OR REPLACE FUNCTION public.pv_role_tenant_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _sign boolean := false;
BEGIN
  IF NOT public.guard_applies() THEN RETURN NEW; END IF;
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
    IF NEW.client_otp_verified IS TRUE OR NEW.client_identity_verified_at IS NOT NULL
       OR NEW.client_identity_verified_by IS NOT NULL OR NEW.client_identity_email IS NOT NULL
       OR NEW.client_identity_phone IS NOT NULL OR NEW.client_signature_ip IS NOT NULL
       OR NEW.client_signature_user_agent IS NOT NULL OR NEW.consent_at IS NOT NULL
       OR NEW.consent_text IS NOT NULL OR NEW.sign_token_expires_at IS NOT NULL THEN
      RAISE EXCEPTION 'PV_PROOF_SERVER_ONLY';
    END IF;
    _sign := coalesce(NEW.status, 'brouillon') <> 'brouillon' OR NEW.company_signature IS NOT NULL
      OR NEW.client_signature IS NOT NULL OR NEW.signed_at IS NOT NULL OR NEW.locked_at IS NOT NULL
      OR NEW.sent_to_client_at IS NOT NULL OR NEW.sign_token IS NOT NULL OR NEW.sign_token_hash IS NOT NULL;
  ELSE
    IF NEW.client_otp_verified IS DISTINCT FROM OLD.client_otp_verified
       OR NEW.client_identity_verified_at IS DISTINCT FROM OLD.client_identity_verified_at
       OR NEW.client_identity_verified_by IS DISTINCT FROM OLD.client_identity_verified_by
       OR NEW.client_identity_email IS DISTINCT FROM OLD.client_identity_email
       OR NEW.client_identity_phone IS DISTINCT FROM OLD.client_identity_phone
       OR NEW.client_signature_ip IS DISTINCT FROM OLD.client_signature_ip
       OR NEW.client_signature_user_agent IS DISTINCT FROM OLD.client_signature_user_agent
       OR NEW.consent_at IS DISTINCT FROM OLD.consent_at
       OR NEW.consent_text IS DISTINCT FROM OLD.consent_text
       OR NEW.sign_token_expires_at IS DISTINCT FROM OLD.sign_token_expires_at THEN
      RAISE EXCEPTION 'PV_PROOF_SERVER_ONLY';
    END IF;
    IF OLD.locked_at IS NOT NULL AND (
         NEW.signature_mode IS DISTINCT FROM OLD.signature_mode
      OR NEW.sent_to_email IS DISTINCT FROM OLD.sent_to_email) THEN
      RAISE EXCEPTION 'PV_LOCKED_SIGNED';
    END IF;
    _sign := NEW.status IS DISTINCT FROM OLD.status
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


CREATE OR REPLACE FUNCTION public.pv_reserve_role_tenant_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.guard_applies() THEN RETURN NEW; END IF;
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

CREATE OR REPLACE FUNCTION public.reserve_lift_role_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _company uuid;
BEGIN
  IF NOT public.guard_applies() THEN RETURN NEW; END IF;
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

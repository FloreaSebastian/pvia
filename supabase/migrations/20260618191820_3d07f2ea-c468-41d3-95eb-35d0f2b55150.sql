
-- 1. New columns on chantiers
ALTER TABLE public.chantiers
  ADD COLUMN IF NOT EXISTS received_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS closure_origin text;

-- 2. Helper: write audit log inside triggers
CREATE OR REPLACE FUNCTION public._chantier_audit(
  _company uuid, _user uuid, _chantier uuid, _action text, _meta jsonb
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.audit_logs(company_id, user_id, entity_type, entity_id, action, metadata)
  VALUES (_company, _user, 'chantier', _chantier, _action, COALESCE(_meta, '{}'::jsonb));
$$;

-- 3. Auto-close chantier on PV signed (no reserves)
CREATE OR REPLACE FUNCTION public.chantier_auto_close_from_pv()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev_status text;
BEGIN
  IF NEW.chantier_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.status <> 'signe' OR COALESCE(OLD.status,'') = 'signe' THEN RETURN NEW; END IF;

  SELECT status INTO v_prev_status FROM public.chantiers WHERE id = NEW.chantier_id;
  IF v_prev_status IN ('termine','archive') THEN RETURN NEW; END IF;

  IF COALESCE(NEW.reception_with_reserves, false) = false THEN
    -- Cas 1 : PV signé sans réserve → réception + clôture
    UPDATE public.chantiers
       SET status = 'termine',
           received_at = COALESCE(received_at, NEW.signed_at, now()),
           closed_at = now(),
           closure_origin = 'pv_no_reserve',
           updated_at = now()
     WHERE id = NEW.chantier_id;
    PERFORM public._chantier_audit(NEW.company_id, NEW.owner_id, NEW.chantier_id,
      'chantier.received_from_pv', jsonb_build_object('pv_id', NEW.id, 'pv_numero', NEW.numero));
    PERFORM public._chantier_audit(NEW.company_id, NEW.owner_id, NEW.chantier_id,
      'chantier.closed_from_pv', jsonb_build_object('pv_id', NEW.id, 'pv_numero', NEW.numero));
  ELSE
    -- PV signé avec réserves → marque réceptionné, attend levée pour clôturer
    UPDATE public.chantiers
       SET status = CASE WHEN status IN ('termine','archive') THEN status ELSE 'receptionne' END,
           received_at = COALESCE(received_at, NEW.signed_at, now()),
           updated_at = now()
     WHERE id = NEW.chantier_id AND status NOT IN ('termine','archive');
    PERFORM public._chantier_audit(NEW.company_id, NEW.owner_id, NEW.chantier_id,
      'chantier.received_from_pv', jsonb_build_object('pv_id', NEW.id, 'with_reserves', true));
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_chantier_auto_close_from_pv ON public.pv;
CREATE TRIGGER trg_chantier_auto_close_from_pv
AFTER UPDATE OF status ON public.pv
FOR EACH ROW EXECUTE FUNCTION public.chantier_auto_close_from_pv();

-- 4. Auto-close chantier when every reserve of the chantier is validated
CREATE OR REPLACE FUNCTION public.chantier_auto_close_from_reserves()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_chantier uuid;
  v_company uuid;
  v_total int;
  v_validated int;
  v_status text;
BEGIN
  SELECT chantier_id, company_id INTO v_chantier, v_company FROM public.pv WHERE id = NEW.pv_id;
  IF v_chantier IS NULL THEN RETURN NEW; END IF;

  SELECT status INTO v_status FROM public.chantiers WHERE id = v_chantier;
  IF v_status IN ('termine','archive') THEN RETURN NEW; END IF;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE r.status = 'validee')
    INTO v_total, v_validated
    FROM public.pv_reserves r
    JOIN public.pv p ON p.id = r.pv_id
   WHERE p.chantier_id = v_chantier;

  IF v_total > 0 AND v_validated = v_total THEN
    UPDATE public.chantiers
       SET status = 'termine',
           closed_at = now(),
           closure_origin = 'reserves_validated',
           updated_at = now()
     WHERE id = v_chantier AND status NOT IN ('termine','archive');
    PERFORM public._chantier_audit(v_company, NEW.owner_id, v_chantier,
      'chantier.closed_from_reserves',
      jsonb_build_object('reserves_total', v_total, 'pv_id', NEW.pv_id));
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_chantier_auto_close_from_reserves ON public.pv_reserves;
CREATE TRIGGER trg_chantier_auto_close_from_reserves
AFTER UPDATE OF status ON public.pv_reserves
FOR EACH ROW EXECUTE FUNCTION public.chantier_auto_close_from_reserves();

-- 5. Reopen chantier when a new reserve is created after closure
CREATE OR REPLACE FUNCTION public.chantier_reopen_on_new_reserve()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_chantier uuid;
  v_company uuid;
  v_status text;
BEGIN
  SELECT chantier_id, company_id INTO v_chantier, v_company FROM public.pv WHERE id = NEW.pv_id;
  IF v_chantier IS NULL THEN RETURN NEW; END IF;
  SELECT status INTO v_status FROM public.chantiers WHERE id = v_chantier;
  IF v_status IN ('termine','archive') THEN
    UPDATE public.chantiers
       SET status = 'en_cours',
           closed_at = NULL,
           closure_origin = NULL,
           updated_at = now()
     WHERE id = v_chantier;
    PERFORM public._chantier_audit(v_company, NEW.owner_id, v_chantier,
      'chantier.reopened_from_new_reserve',
      jsonb_build_object('reserve_id', NEW.id, 'pv_id', NEW.pv_id, 'previous_status', v_status));
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_chantier_reopen_on_new_reserve ON public.pv_reserves;
CREATE TRIGGER trg_chantier_reopen_on_new_reserve
AFTER INSERT ON public.pv_reserves
FOR EACH ROW EXECUTE FUNCTION public.chantier_reopen_on_new_reserve();

-- 6. Lock chantier when status IN (termine, archive)
CREATE OR REPLACE FUNCTION public.chantier_block_locked_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_service boolean := COALESCE((current_setting('request.jwt.claims', true)::jsonb->>'role') = 'service_role', false);
  v_uid uuid := auth.uid();
  v_role public.company_role;
BEGIN
  IF v_is_service THEN RETURN COALESCE(NEW, OLD); END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('termine','archive') THEN
      RAISE EXCEPTION 'CHANTIER_LOCKED: Ce chantier est clôturé et ne peut plus être supprimé.'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status NOT IN ('termine','archive') THEN
    RETURN NEW;
  END IF;

  -- Status is locked. Allow only an explicit reopen by directeur/responsable_exploitation.
  v_role := public.get_company_role(OLD.company_id, v_uid);

  -- Reopen path: status moves out of locked to en_cours (other fields kept identical)
  IF NEW.status = 'en_cours' AND OLD.status IN ('termine','archive') THEN
    IF v_role NOT IN ('directeur','responsable_exploitation') THEN
      RAISE EXCEPTION 'CHANTIER_REOPEN_FORBIDDEN: Seul un directeur ou responsable d''exploitation peut réouvrir un chantier.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  -- Any other modification while locked → reject (unless it's a no-op timestamp touch)
  IF NEW.name IS DISTINCT FROM OLD.name
     OR NEW.address IS DISTINCT FROM OLD.address
     OR NEW.address_line1 IS DISTINCT FROM OLD.address_line1
     OR NEW.postal_code IS DISTINCT FROM OLD.postal_code
     OR NEW.city IS DISTINCT FROM OLD.city
     OR NEW.latitude IS DISTINCT FROM OLD.latitude
     OR NEW.longitude IS DISTINCT FROM OLD.longitude
     OR NEW.type IS DISTINCT FROM OLD.type
     OR NEW.client_id IS DISTINCT FROM OLD.client_id
     OR NEW.start_date IS DISTINCT FROM OLD.start_date
     OR NEW.end_date IS DISTINCT FROM OLD.end_date
     OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW.color IS DISTINCT FROM OLD.color
     OR NEW.progress_percent IS DISTINCT FROM OLD.progress_percent
     OR NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'CHANTIER_LOCKED: Ce chantier est clôturé. Réouvrez-le pour le modifier.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_chantier_block_locked_changes ON public.chantiers;
CREATE TRIGGER trg_chantier_block_locked_changes
BEFORE UPDATE OR DELETE ON public.chantiers
FOR EACH ROW EXECUTE FUNCTION public.chantier_block_locked_changes();

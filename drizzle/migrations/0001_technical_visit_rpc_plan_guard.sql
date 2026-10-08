-- Garde d'offre dans les fonctions elles-mêmes (appel direct refusé hors Pro/Business/Entreprise).
CREATE OR REPLACE FUNCTION public.create_technical_visit_atomic(
  _company_id uuid,
  _client_id uuid,
  _visit_type text,
  _idempotency_key text,
  _chantier_id uuid,
  _new_chantier jsonb,
  _planning jsonb,
  _event_title text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _existing record;
  _chantier record;
  _ch_id uuid;
  _ch_created boolean := false;
  _visit record;
  _event_id uuid;
  _assigned uuid := NULLIF(_planning->>'assigned_to','')::uuid;
  _scheduled timestamptz := NULLIF(_planning->>'scheduled_at','')::timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'VT_AUTH_REQUIRED'; END IF;
  IF NOT public.has_plan_feature(_company_id, 'technical_visits') THEN RAISE EXCEPTION 'VT_PLAN_REQUIRED'; END IF;
  IF _idempotency_key IS NULL OR length(_idempotency_key) < 8 THEN RAISE EXCEPTION 'VT_IDEMPOTENCY_REQUIRED'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(_company_id::text || ':' || _idempotency_key, 0));

  SELECT id, reference, chantier_id INTO _existing
  FROM technical_visits WHERE company_id = _company_id AND idempotency_key = _idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object('id', _existing.id, 'reference', _existing.reference,
      'chantier_id', _existing.chantier_id, 'chantier_created', false, 'reused', true);
  END IF;

  PERFORM 1 FROM clients WHERE id = _client_id AND company_id = _company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'VT_CLIENT_NOT_FOUND'; END IF;

  IF _assigned IS NOT NULL THEN
    PERFORM 1 FROM company_members
     WHERE company_id = _company_id AND user_id = _assigned AND status = 'active';
    IF NOT FOUND THEN RAISE EXCEPTION 'VT_ASSIGNEE_INVALID'; END IF;
  END IF;

  IF _chantier_id IS NOT NULL THEN
    SELECT id, client_id, address INTO _chantier FROM chantiers
     WHERE id = _chantier_id AND company_id = _company_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'VT_CHANTIER_NOT_FOUND'; END IF;
    IF _chantier.client_id IS DISTINCT FROM _client_id THEN RAISE EXCEPTION 'VT_CHANTIER_CLIENT_MISMATCH'; END IF;
    _ch_id := _chantier.id;
  ELSE
    INSERT INTO chantiers (company_id, owner_id, client_id, name, type, status, address, address_line1, postal_code, city, latitude, longitude)
    VALUES (
      _company_id, _uid, _client_id,
      left(coalesce(NULLIF(_new_chantier->>'name',''), 'Chantier'), 200),
      NULLIF(_new_chantier->>'type',''),
      'preparation',
      NULLIF(_new_chantier->>'address',''),
      NULLIF(_new_chantier->>'address_line1',''),
      NULLIF(_new_chantier->>'postal_code',''),
      NULLIF(_new_chantier->>'city',''),
      NULLIF(_new_chantier->>'latitude','')::double precision,
      NULLIF(_new_chantier->>'longitude','')::double precision
    ) RETURNING id, client_id, address INTO _chantier;
    _ch_id := _chantier.id;
    _ch_created := true;
  END IF;

  INSERT INTO technical_visits (company_id, chantier_id, client_id, visit_type, status, assigned_to, scheduled_at,
    site_contact_name, site_contact_phone, site_address, prep_notes, created_by, idempotency_key)
  VALUES (_company_id, _ch_id, _client_id, _visit_type,
    CASE WHEN _scheduled IS NOT NULL THEN 'planifiee' ELSE 'a_planifier' END,
    _assigned, _scheduled,
    NULLIF(_planning->>'site_contact_name',''), NULLIF(_planning->>'site_contact_phone',''),
    _chantier.address, NULLIF(_planning->>'prep_notes',''), _uid, _idempotency_key)
  RETURNING id, reference INTO _visit;

  IF _scheduled IS NOT NULL THEN
    INSERT INTO chantier_events (company_id, chantier_id, client_id, title, description, event_type, status,
      start_at, end_at, all_day, assigned_to, location, created_by)
    VALUES (_company_id, _ch_id, _client_id, left(_event_title || ' — ' || _visit.reference, 300),
      NULLIF(_planning->>'prep_notes',''), 'visite_technique', 'prevu',
      _scheduled, _scheduled + interval '2 hours', false, _assigned, _chantier.address, _uid)
    RETURNING id INTO _event_id;
    UPDATE technical_visits SET calendar_event_id = _event_id WHERE id = _visit.id;
  END IF;

  RETURN jsonb_build_object('id', _visit.id, 'reference', _visit.reference, 'chantier_id', _ch_id,
    'chantier_created', _ch_created, 'reused', false, 'calendar_event_id', _event_id);
END;
$$;

REVOKE ALL ON FUNCTION public.create_technical_visit_atomic(uuid, uuid, text, text, uuid, jsonb, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_technical_visit_atomic(uuid, uuid, text, text, uuid, jsonb, jsonb, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_technical_visit_planning(
  _company_id uuid,
  _visit_id uuid,
  _planning jsonb,
  _event_title text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _v record;
  _assigned uuid := NULLIF(_planning->>'assigned_to','')::uuid;
  _scheduled timestamptz := NULLIF(_planning->>'scheduled_at','')::timestamptz;
  _status text;
  _event_id uuid;
  _event_action text := 'none';
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'VT_AUTH_REQUIRED'; END IF;
  IF NOT public.has_plan_feature(_company_id, 'technical_visits') THEN RAISE EXCEPTION 'VT_PLAN_REQUIRED'; END IF;
  SELECT * INTO _v FROM technical_visits WHERE id = _visit_id AND company_id = _company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'VT_VISIT_NOT_FOUND'; END IF;
  IF _v.status = 'archivee' THEN RAISE EXCEPTION 'VT_VISIT_ARCHIVED'; END IF;

  IF _assigned IS NOT NULL THEN
    PERFORM 1 FROM company_members
     WHERE company_id = _company_id AND user_id = _assigned AND status = 'active';
    IF NOT FOUND THEN RAISE EXCEPTION 'VT_ASSIGNEE_INVALID'; END IF;
  END IF;

  _status := _v.status;
  IF _v.status = 'a_planifier' AND _scheduled IS NOT NULL THEN _status := 'planifiee'; END IF;
  IF _v.status = 'planifiee' AND _scheduled IS NULL THEN _status := 'a_planifier'; END IF;

  _event_id := _v.calendar_event_id;
  IF _scheduled IS NOT NULL THEN
    IF _event_id IS NOT NULL THEN
      UPDATE chantier_events SET start_at = _scheduled, end_at = _scheduled + interval '2 hours',
        assigned_to = _assigned, status = CASE WHEN status = 'annule' THEN 'prevu' ELSE status END,
        description = NULLIF(_planning->>'prep_notes','')
      WHERE id = _event_id AND company_id = _company_id;
      IF FOUND THEN _event_action := 'updated'; ELSE _event_id := NULL; END IF;
    END IF;
    IF _event_id IS NULL THEN
      INSERT INTO chantier_events (company_id, chantier_id, client_id, title, description, event_type, status,
        start_at, end_at, all_day, assigned_to, location, created_by)
      VALUES (_company_id, _v.chantier_id, _v.client_id, left(_event_title || ' — ' || _v.reference, 300),
        NULLIF(_planning->>'prep_notes',''), 'visite_technique', 'prevu',
        _scheduled, _scheduled + interval '2 hours', false, _assigned, _v.site_address, _uid)
      RETURNING id INTO _event_id;
      _event_action := 'created';
    END IF;
  ELSIF _event_id IS NOT NULL THEN
    UPDATE chantier_events SET status = 'annule' WHERE id = _event_id AND company_id = _company_id;
    _event_action := 'cancelled';
  END IF;

  UPDATE technical_visits SET
    assigned_to = _assigned,
    scheduled_at = _scheduled,
    site_contact_name = NULLIF(_planning->>'site_contact_name',''),
    site_contact_phone = NULLIF(_planning->>'site_contact_phone',''),
    prep_notes = NULLIF(_planning->>'prep_notes',''),
    status = _status,
    calendar_event_id = _event_id
  WHERE id = _visit_id AND company_id = _company_id;

  RETURN jsonb_build_object('status', _status, 'calendar_event_id', _event_id, 'event_action', _event_action,
    'prev_assigned_to', _v.assigned_to, 'prev_scheduled_at', _v.scheduled_at);
END;
$$;

REVOKE ALL ON FUNCTION public.update_technical_visit_planning(uuid, uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_technical_visit_planning(uuid, uuid, jsonb, text) TO authenticated;
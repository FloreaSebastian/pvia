-- Correctif 0004 : la surcharge à 9 arguments insère directement les lots (une visite BTP
-- sans lot est refusée par la contrainte, l'enrobage de 0004 ne pouvait donc pas réussir).
-- L'ancienne signature à 8 arguments reste inchangée pour l'application publiée.
CREATE OR REPLACE FUNCTION public.create_technical_visit_atomic(
  _company_id uuid,
  _client_id uuid,
  _visit_type text,
  _idempotency_key text,
  _chantier_id uuid,
  _new_chantier jsonb,
  _planning jsonb,
  _event_title text,
  _lots text[]
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
  IF NOT public.can_manage_company(_company_id, _uid) THEN RAISE EXCEPTION 'VT_FORBIDDEN'; END IF;
  IF NOT public.can_write_company(_company_id, _uid) THEN RAISE EXCEPTION 'VT_WRITE_LOCKED'; END IF;
  IF NOT public.has_plan_feature(_company_id, 'technical_visits') THEN RAISE EXCEPTION 'VT_PLAN_REQUIRED'; END IF;
  IF _idempotency_key IS NULL OR length(_idempotency_key) < 8 THEN RAISE EXCEPTION 'VT_IDEMPOTENCY_REQUIRED'; END IF;
  IF _visit_type = 'btp' AND coalesce(cardinality(_lots), 0) < 1 THEN RAISE EXCEPTION 'VT_LOTS_REQUIRED'; END IF;
  IF _visit_type <> 'btp' AND coalesce(cardinality(_lots), 0) > 0 THEN RAISE EXCEPTION 'VT_LOTS_INVALID'; END IF;

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
    site_contact_name, site_contact_phone, site_address, prep_notes, created_by, idempotency_key, lots)
  VALUES (_company_id, _ch_id, _client_id, _visit_type,
    CASE WHEN _scheduled IS NOT NULL THEN 'planifiee' ELSE 'a_planifier' END,
    _assigned, _scheduled,
    NULLIF(_planning->>'site_contact_name',''), NULLIF(_planning->>'site_contact_phone',''),
    _chantier.address, NULLIF(_planning->>'prep_notes',''), _uid, _idempotency_key, coalesce(_lots, '{}'::text[]))
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

REVOKE ALL ON FUNCTION public.create_technical_visit_atomic(uuid, uuid, text, text, uuid, jsonb, jsonb, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_technical_visit_atomic(uuid, uuid, text, text, uuid, jsonb, jsonb, text, text[]) TO authenticated;

-- Ajout de lots (jamais de retrait) sur une visite BTP non clôturée. Droits de l'appelant (RLS).
CREATE OR REPLACE FUNCTION public.add_technical_visit_lots(_company_id uuid, _visit_id uuid, _lots text[])
RETURNS text[]
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _canon text[] := ARRAY['photovoltaique','pac_air_air','pac_air_eau','electricite','plomberie','ventilation','isolation_facade','toiture','renovation'];
  _v record;
  _new text[];
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'VT_AUTH_REQUIRED'; END IF;
  IF NOT public.can_write_company(_company_id, _uid) THEN RAISE EXCEPTION 'VT_WRITE_LOCKED'; END IF;
  IF NOT public.has_plan_feature(_company_id, 'technical_visits') THEN RAISE EXCEPTION 'VT_PLAN_REQUIRED'; END IF;
  IF NOT public.can_edit_technical_visit(_visit_id, _uid) THEN RAISE EXCEPTION 'VT_FORBIDDEN'; END IF;
  IF _lots IS NULL OR cardinality(_lots) = 0 OR NOT (_lots <@ _canon) THEN RAISE EXCEPTION 'VT_LOTS_INVALID'; END IF;
  SELECT id, visit_type, status, lots INTO _v FROM technical_visits
   WHERE id = _visit_id AND company_id = _company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'VT_FORBIDDEN'; END IF;
  IF _v.visit_type <> 'btp' THEN RAISE EXCEPTION 'VT_LOTS_INVALID'; END IF;
  IF _v.status NOT IN ('a_planifier','planifiee','en_cours','a_completer') THEN RAISE EXCEPTION 'VT_VISIT_LOCKED'; END IF;
  SELECT array_agg(c ORDER BY o) INTO _new
    FROM unnest(_canon) WITH ORDINALITY AS t(c, o)
   WHERE c = ANY(_v.lots) OR c = ANY(_lots);
  UPDATE technical_visits SET lots = _new WHERE id = _visit_id AND company_id = _company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'VT_FORBIDDEN'; END IF;
  RETURN _new;
END;
$$;
REVOKE ALL ON FUNCTION public.add_technical_visit_lots(uuid, uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_technical_visit_lots(uuid, uuid, text[]) TO authenticated;

-- Recherche globale avec filtre par lot (nouvelle surcharge ; l'ancienne reste inchangée).
CREATE OR REPLACE FUNCTION public.search_technical_visits(
  _company_id uuid, _term text, _visit_type text, _status text, _assigned_to uuid, _chantier_id uuid,
  _client_id uuid, _from date, _to date, _include_archived boolean, _offset integer, _limit integer, _lot text
) RETURNS TABLE(id uuid, total bigint)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH pattern AS (
    SELECT '%' || replace(replace(replace(lower(coalesce(_term,'')), '\', '\\'), '%', '\%'), '_', '\_') || '%' AS p
  ), matched AS (
    SELECT v.id, v.scheduled_at, v.created_at
    FROM technical_visits v
    LEFT JOIN chantiers ch ON ch.id = v.chantier_id AND ch.company_id = v.company_id
    LEFT JOIN clients cl ON cl.id = v.client_id AND cl.company_id = v.company_id
    CROSS JOIN pattern
    WHERE v.company_id = _company_id
      AND (_include_archived OR v.status <> 'archivee')
      AND (_visit_type IS NULL OR v.visit_type = _visit_type)
      AND (_lot IS NULL OR _lot = ANY(v.lots))
      AND (_status IS NULL OR v.status = _status)
      AND (_assigned_to IS NULL OR v.assigned_to = _assigned_to)
      AND (_chantier_id IS NULL OR v.chantier_id = _chantier_id)
      AND (_client_id IS NULL OR v.client_id = _client_id)
      AND (_from IS NULL OR v.scheduled_at >= _from::timestamptz)
      AND (_to IS NULL OR v.scheduled_at < (_to + 1)::timestamptz)
      AND (
        lower(coalesce(v.reference,'')) LIKE pattern.p
        OR lower(coalesce(v.site_address,'')) LIKE pattern.p
        OR lower(coalesce(ch.name,'')) LIKE pattern.p
        OR lower(coalesce(ch.reference,'')) LIKE pattern.p
        OR lower(coalesce(ch.address,'')) LIKE pattern.p
        OR lower(coalesce(ch.city,'')) LIKE pattern.p
        OR lower(coalesce(ch.postal_code,'')) LIKE pattern.p
        OR lower(coalesce(cl.name,'')) LIKE pattern.p
        OR lower(coalesce(cl.company_name,'')) LIKE pattern.p
      )
  )
  SELECT m.id, count(*) OVER () AS total
  FROM matched m
  ORDER BY m.scheduled_at DESC NULLS LAST, m.created_at DESC
  OFFSET greatest(_offset, 0) LIMIT least(greatest(_limit, 1), 100);
$$;
REVOKE ALL ON FUNCTION public.search_technical_visits(uuid, text, text, text, uuid, uuid, uuid, date, date, boolean, integer, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_technical_visits(uuid, text, text, text, uuid, uuid, uuid, date, date, boolean, integer, integer, text) TO authenticated;
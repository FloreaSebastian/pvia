CREATE OR REPLACE FUNCTION public.apply_technical_visit_answers_cas(_company_id uuid, _visit_id uuid, _entries jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _e jsonb;
  _key text;
  _cur jsonb;
  _found boolean;
  _exp jsonb;
  _applied text[] := '{}';
  _conflicts jsonb := '[]'::jsonb;
  _n int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(_entries) <> 'array' OR jsonb_array_length(_entries) = 0 OR jsonb_array_length(_entries) > 50 THEN
    RAISE EXCEPTION 'invalid_entries' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM technical_visits v WHERE v.id = _visit_id AND v.company_id = _company_id) THEN
    RAISE EXCEPTION 'visit_not_found' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_company_member(_company_id, _uid) OR NOT public.can_write_company(_company_id, _uid)
     OR NOT public.has_plan_feature(_company_id, 'technical_visits') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  -- Verrou de la visite : sérialise avec changement de statut et autres applications IA.
  PERFORM 1 FROM technical_visits WHERE id = _visit_id FOR UPDATE;
  IF NOT public.can_edit_technical_visit(_visit_id, _uid) THEN
    RAISE EXCEPTION 'locked' USING ERRCODE = '42501';
  END IF;

  FOR _e IN SELECT * FROM jsonb_array_elements(_entries) LOOP
    _key := _e->>'field_key';
    IF _key IS NULL OR length(_key) > 200 OR (_e->>'section_key') IS NULL THEN
      RAISE EXCEPTION 'invalid_entries' USING ERRCODE = '22023';
    END IF;
    _exp := CASE WHEN _e->'expected' IS NULL OR _e->'expected' IN ('null'::jsonb, '""'::jsonb, '[]'::jsonb) THEN 'null'::jsonb ELSE _e->'expected' END;
    SELECT CASE WHEN a.value IS NULL OR a.value IN ('null'::jsonb, '""'::jsonb, '[]'::jsonb) THEN 'null'::jsonb ELSE a.value END, true
      INTO _cur, _found
      FROM technical_visit_answers a WHERE a.visit_id = _visit_id AND a.field_key = _key FOR UPDATE;
    IF _found THEN
      IF _cur IS DISTINCT FROM _exp THEN
        _conflicts := _conflicts || jsonb_build_object('field_key', _key, 'current', _cur);
      ELSE
        UPDATE technical_visit_answers SET value = _e->'value', section_key = _e->>'section_key', updated_at = now()
         WHERE visit_id = _visit_id AND field_key = _key;
        _applied := _applied || _key;
      END IF;
    ELSIF _exp <> 'null'::jsonb THEN
      _conflicts := _conflicts || jsonb_build_object('field_key', _key, 'current', 'null'::jsonb);
    ELSE
      INSERT INTO technical_visit_answers(visit_id, company_id, section_key, field_key, value)
      VALUES (_visit_id, _company_id, _e->>'section_key', _key, _e->'value')
      ON CONFLICT (visit_id, field_key) DO NOTHING;
      GET DIAGNOSTICS _n = ROW_COUNT;
      IF _n = 1 THEN
        _applied := _applied || _key;
      ELSE
        SELECT a.value INTO _cur FROM technical_visit_answers a WHERE a.visit_id = _visit_id AND a.field_key = _key;
        _conflicts := _conflicts || jsonb_build_object('field_key', _key, 'current', coalesce(_cur, 'null'::jsonb));
      END IF;
    END IF;
    _found := false;
  END LOOP;
  RETURN jsonb_build_object('applied', to_jsonb(_applied), 'conflicts', _conflicts);
END $$;

REVOKE ALL ON FUNCTION public.apply_technical_visit_answers_cas(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_technical_visit_answers_cas(uuid, uuid, jsonb) TO authenticated, service_role;
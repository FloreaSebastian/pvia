CREATE OR REPLACE FUNCTION public.solar_apply_electrical_design_trusted(
  _actor uuid, _company_id uuid, _model_id uuid, _expected_geometry_version integer,
  _expected_layout_version integer, _expected_layout_hash text, _design jsonb, _strings jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _geo integer; _lv integer; _design_id uuid; _s jsonb; _sid uuid; _mid text; _pos integer;
  _spos integer := 0; _total integer := 0; _seen uuid[] := '{}';
BEGIN
  IF _actor IS NULL OR NOT can_manage_company(_company_id, _actor) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT company_has_write_access(_company_id) THEN RAISE EXCEPTION 'subscription_unusable'; END IF;
  IF _expected_geometry_version IS NULL OR _expected_layout_version IS NULL OR coalesce(_expected_layout_hash,'') = '' THEN
    RAISE EXCEPTION 'expected_versions_required'; END IF;
  SELECT geometry_version, layout_version INTO _geo, _lv FROM solar_models
   WHERE id=_model_id AND company_id=_company_id FOR UPDATE;
  IF _geo IS NULL THEN RAISE EXCEPTION 'model_not_found'; END IF;
  IF _geo <> _expected_geometry_version OR _lv <> _expected_layout_version
     OR solar_layout_fingerprint(_company_id, _model_id) <> _expected_layout_hash THEN
    RAISE EXCEPTION 'stale_layout'; END IF;
  IF _design IS NULL OR jsonb_typeof(_design) <> 'object' OR _strings IS NULL OR jsonb_typeof(_strings) <> 'array' THEN
    RAISE EXCEPTION 'invalid_design_payload'; END IF;
  IF jsonb_array_length(_strings) > 500 THEN RAISE EXCEPTION 'too_many_strings'; END IF;
  IF coalesce(_design->>'topology','') NOT IN ('string','hybride','micro') THEN RAISE EXCEPTION 'invalid_topology'; END IF;
  IF coalesce(_design->>'status','') NOT IN ('valide','avertissement','non_verifiable') THEN RAISE EXCEPTION 'invalid_status'; END IF;
  IF coalesce(_design->>'signature','') = '' OR coalesce(_design->>'engine_version','') = ''
     OR coalesce(_design->>'temp_source','') = '' THEN RAISE EXCEPTION 'invalid_design_payload'; END IF;

  UPDATE solar_electrical_designs SET is_current=false WHERE model_id=_model_id AND company_id=_company_id AND is_current;
  INSERT INTO solar_electrical_designs (company_id, model_id, topology, inverter_id, inverter_revision_id,
    inverter_snapshot, inverter_count, module_electrical_snapshot, temp_min_c, temp_max_c, temp_source,
    geometry_version, geometry_hash, layout_version, layout_hash, engine_version, signature, status,
    variant_label, summary, warnings, created_by)
  VALUES (_company_id, _model_id, _design->>'topology',
    nullif(_design->>'inverter_id','')::uuid, nullif(_design->>'inverter_revision_id','')::uuid,
    coalesce(_design->'inverter_snapshot','{}'::jsonb), coalesce((_design->>'inverter_count')::integer,1),
    coalesce(_design->'module_electrical_snapshot','{}'::jsonb),
    (_design->>'temp_min_c')::numeric, (_design->>'temp_max_c')::numeric, _design->>'temp_source',
    _geo, nullif(_design->>'geometry_hash',''), _lv, _expected_layout_hash,
    _design->>'engine_version', _design->>'signature', _design->>'status',
    nullif(_design->>'variant_label',''), coalesce(_design->'summary','{}'::jsonb),
    coalesce(_design->'warnings','[]'::jsonb), _actor)
  RETURNING id INTO _design_id;

  FOR _s IN SELECT * FROM jsonb_array_elements(_strings) LOOP
    _spos := _spos + 1;
    IF jsonb_typeof(coalesce(_s->'module_ids','null'::jsonb)) <> 'array' THEN RAISE EXCEPTION 'invalid_string_modules'; END IF;
    INSERT INTO solar_electrical_strings (design_id, company_id, kind, label, inverter_index, mppt_index, input_index,
      position, module_count, results)
    VALUES (_design_id, _company_id, CASE WHEN _s->>'kind'='micro' THEN 'micro' ELSE 'string' END,
      coalesce(_s->>'label', 'S'||_spos), coalesce((_s->>'inverter_index')::integer,0),
      nullif(_s->>'mppt_index','')::integer, nullif(_s->>'input_index','')::integer, _spos,
      jsonb_array_length(_s->'module_ids'), coalesce(_s->'results','{}'::jsonb))
    RETURNING id INTO _sid;
    _pos := 0;
    FOR _mid IN SELECT jsonb_array_elements_text(_s->'module_ids') LOOP
      _pos := _pos + 1; _total := _total + 1;
      IF _mid::uuid = ANY(_seen) THEN RAISE EXCEPTION 'duplicate_module_assignment'; END IF;
      _seen := _seen || _mid::uuid;
      IF NOT EXISTS (SELECT 1 FROM solar_modules_placed WHERE id=_mid::uuid AND model_id=_model_id AND company_id=_company_id AND enabled) THEN
        RAISE EXCEPTION 'module_not_found'; END IF;
      INSERT INTO solar_electrical_assignments (design_id, string_id, company_id, module_id, position)
      VALUES (_design_id, _sid, _company_id, _mid::uuid, _pos);
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('design_id', _design_id, 'assigned', _total, 'layout_version', _lv);
END; $$;
REVOKE ALL ON FUNCTION public.solar_apply_electrical_design_trusted(uuid, uuid, uuid, integer, integer, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.solar_apply_electrical_design_trusted(uuid, uuid, uuid, integer, integer, text, jsonb, jsonb) TO service_role;
REVOKE EXECUTE ON FUNCTION public.solar_apply_electrical_design(uuid, uuid, integer, integer, text, jsonb, jsonb) FROM authenticated;
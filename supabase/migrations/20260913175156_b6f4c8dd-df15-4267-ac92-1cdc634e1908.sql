CREATE OR REPLACE FUNCTION public.solar_apply_layout(
  _company_id uuid,
  _model_id uuid,
  _expected_geometry_version integer,
  _arrays jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _current_version integer;
  _array jsonb;
  _array_id uuid;
  _plane_id uuid;
  _module jsonb;
  _index integer;
  _total integer := 0;
BEGIN
  IF NOT can_manage_company(_company_id, auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT geometry_version INTO _current_version
  FROM public.solar_models
  WHERE id = _model_id AND company_id = _company_id
  FOR UPDATE;

  IF _current_version IS NULL THEN
    RAISE EXCEPTION 'model_not_found';
  END IF;

  IF _expected_geometry_version IS NOT NULL AND _expected_geometry_version <> _current_version THEN
    RAISE EXCEPTION 'stale_geometry_version';
  END IF;

  FOR _array IN SELECT * FROM jsonb_array_elements(_arrays)
  LOOP
    _plane_id := (_array->>'roof_plane_id')::uuid;

    IF NOT EXISTS (
      SELECT 1 FROM public.solar_roof_planes
      WHERE id = _plane_id AND model_id = _model_id AND company_id = _company_id
    ) THEN
      RAISE EXCEPTION 'plane_not_found';
    END IF;

    DELETE FROM public.solar_modules_placed
    WHERE company_id = _company_id AND model_id = _model_id AND roof_plane_id = _plane_id;

    DELETE FROM public.solar_arrays
    WHERE company_id = _company_id AND model_id = _model_id AND roof_plane_id = _plane_id;

    INSERT INTO public.solar_arrays (
      company_id, model_id, roof_plane_id, module_catalog_id, label, orientation,
      row_gap_m, col_gap_m, params, rules_profile_id, rules_profile_version, layout_engine_version
    )
    VALUES (
      _company_id, _model_id, _plane_id,
      NULLIF(_array->>'module_catalog_id','')::uuid,
      COALESCE(_array->>'label','Champ'),
      COALESCE(_array->>'orientation','portrait'),
      COALESCE((_array->>'row_gap_m')::numeric, 0),
      COALESCE((_array->>'col_gap_m')::numeric, 0),
      COALESCE(_array->'params', '{}'::jsonb),
      NULLIF(_array->>'rules_profile_id','')::uuid,
      NULLIF(_array->>'rules_profile_version','')::integer,
      _array->>'layout_engine_version'
    )
    RETURNING id INTO _array_id;

    _index := 0;
    FOR _module IN SELECT * FROM jsonb_array_elements(COALESCE(_array->'modules','[]'::jsonb))
    LOOP
      _index := _index + 1;
      _total := _total + 1;
      INSERT INTO public.solar_modules_placed (
        company_id, model_id, array_id, roof_plane_id, index_label,
        grid_row, grid_col, local_u_m, local_v_m, orientation, enabled,
        validity_status, validity_cause, variant_id
      )
      VALUES (
        _company_id, _model_id, _array_id, _plane_id, _index,
        NULLIF(_module->>'grid_row','')::integer,
        NULLIF(_module->>'grid_col','')::integer,
        (_module->>'local_u_m')::numeric,
        (_module->>'local_v_m')::numeric,
        COALESCE(_module->>'orientation','portrait'),
        COALESCE((_module->>'enabled')::boolean, true),
        COALESCE(_module->>'validity_status','valid'),
        NULLIF(_module->>'validity_cause',''),
        NULLIF(_array->>'variant_id','')::uuid
      );
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('modules', _total, 'geometry_version', _current_version);
END;
$$;

REVOKE ALL ON FUNCTION public.solar_apply_layout(uuid, uuid, integer, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.solar_apply_layout(uuid, uuid, integer, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.solar_apply_layout(uuid, uuid, integer, jsonb) TO service_role;
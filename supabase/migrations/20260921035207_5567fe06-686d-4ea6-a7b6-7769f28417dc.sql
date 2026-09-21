CREATE OR REPLACE FUNCTION public.solar_apply_roof_geometry(
  _company_id uuid,
  _model_id uuid,
  _expected_geometry_version integer,
  _mode text,
  _allow_mode_switch boolean,
  _custom_planes jsonb,
  _planes jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _current_version integer;
  _building record;
  _plane jsonb;
  _plane_id uuid;
  _keys text[] := ARRAY[]::text[];
  _kept integer := 0;
  _deleted integer := 0;
  _new_version integer;
  _hash text;
BEGIN
  IF NOT can_manage_company(_company_id, auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF _expected_geometry_version IS NULL THEN
    RAISE EXCEPTION 'expected_geometry_version_required';
  END IF;

  IF _mode NOT IN ('parametric', 'polygon') THEN
    RAISE EXCEPTION 'invalid_geometry_mode';
  END IF;

  SELECT geometry_version INTO _current_version
  FROM public.solar_models
  WHERE id = _model_id AND company_id = _company_id
  FOR UPDATE;

  IF _current_version IS NULL THEN
    RAISE EXCEPTION 'model_not_found';
  END IF;

  IF _current_version <> _expected_geometry_version THEN
    RAISE EXCEPTION 'stale_geometry_version';
  END IF;

  SELECT * INTO _building
  FROM public.solar_buildings
  WHERE model_id = _model_id AND company_id = _company_id
  FOR UPDATE;

  IF _building.id IS NULL THEN
    RAISE EXCEPTION 'building_not_found';
  END IF;

  IF _mode = 'polygon' AND COALESCE(jsonb_array_length(_planes), 0) = 0 THEN
    RAISE EXCEPTION 'empty_polygon_geometry';
  END IF;

  IF _mode = 'polygon'
     AND _building.geometry_mode <> 'polygon'
     AND NOT COALESCE(_allow_mode_switch, false) THEN
    RAISE EXCEPTION 'conversion_required';
  END IF;

  IF _mode = 'parametric' AND _building.geometry_mode = 'polygon' THEN
    RAISE EXCEPTION 'polygon_mode_is_final';
  END IF;

  UPDATE public.solar_buildings
  SET geometry_mode = _mode,
      custom_planes = COALESCE(_custom_planes, '[]'::jsonb),
      updated_at = now()
  WHERE id = _building.id AND company_id = _company_id;

  FOR _plane IN SELECT * FROM jsonb_array_elements(COALESCE(_planes, '[]'::jsonb))
  LOOP
    IF COALESCE(_plane->>'key', '') = '' THEN
      RAISE EXCEPTION 'plane_key_required';
    END IF;
    _keys := _keys || (_plane->>'key');

    SELECT id INTO _plane_id
    FROM public.solar_roof_planes
    WHERE model_id = _model_id
      AND company_id = _company_id
      AND polygon->>'key' = _plane->>'key'
    LIMIT 1;

    IF _plane_id IS NULL THEN
      INSERT INTO public.solar_roof_planes (
        company_id, model_id, building_id, name, azimuth_deg, tilt_deg,
        area_m2, eave_height_m, ridge_height_m, polygon, data_source
      ) VALUES (
        _company_id, _model_id, _building.id,
        COALESCE(_plane->>'name', 'Pan'),
        (_plane->>'azimuth_deg')::numeric,
        (_plane->>'tilt_deg')::numeric,
        (_plane->>'area_m2')::numeric,
        NULLIF(_plane->>'eave_height_m','')::numeric,
        NULLIF(_plane->>'ridge_height_m','')::numeric,
        _plane->'polygon',
        'manuel'
      )
      RETURNING id INTO _plane_id;
    ELSE
      UPDATE public.solar_roof_planes
      SET building_id = _building.id,
          name = COALESCE(_plane->>'name', name),
          azimuth_deg = (_plane->>'azimuth_deg')::numeric,
          tilt_deg = (_plane->>'tilt_deg')::numeric,
          area_m2 = (_plane->>'area_m2')::numeric,
          eave_height_m = NULLIF(_plane->>'eave_height_m','')::numeric,
          ridge_height_m = NULLIF(_plane->>'ridge_height_m','')::numeric,
          polygon = _plane->'polygon',
          updated_at = now()
      WHERE id = _plane_id AND company_id = _company_id;
    END IF;

    _kept := _kept + 1;

    INSERT INTO public.solar_provenance (
      company_id, model_id, entity_kind, entity_id, attribute,
      source_type, source_provider, source_dataset, confidence
    ) VALUES (
      _company_id, _model_id, 'roof_plane', _plane_id, 'geometry',
      'MANUAL', 'PVIA', 'Contour dessiné Solar Studio', 'measured'
    )
    ON CONFLICT (model_id, entity_kind, entity_id, attribute) DO UPDATE
    SET source_type = EXCLUDED.source_type,
        source_provider = EXCLUDED.source_provider,
        source_dataset = EXCLUDED.source_dataset,
        confidence = EXCLUDED.confidence,
        updated_at = now();
  END LOOP;

  WITH removed AS (
    DELETE FROM public.solar_roof_planes
    WHERE model_id = _model_id
      AND company_id = _company_id
      AND COALESCE(polygon->>'key', '') <> ALL (_keys)
    RETURNING 1
  )
  SELECT count(*) INTO _deleted FROM removed;

  SELECT md5(
    COALESCE(_custom_planes, '[]'::jsonb)::text || '|' || COALESCE(_planes, '[]'::jsonb)::text
  ) INTO _hash;

  _new_version := _current_version + 1;
  UPDATE public.solar_models
  SET geometry_version = _new_version,
      geometry_hash = _hash,
      updated_by = auth.uid(),
      updated_at = now()
  WHERE id = _model_id AND company_id = _company_id;

  RETURN jsonb_build_object(
    'geometry_version', _new_version,
    'geometry_hash', _hash,
    'planes_kept', _kept,
    'planes_deleted', _deleted,
    'geometry_mode', _mode
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.solar_apply_roof_geometry(uuid, uuid, integer, text, boolean, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.solar_apply_roof_geometry(uuid, uuid, integer, text, boolean, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.solar_apply_roof_geometry(uuid, uuid, integer, text, boolean, jsonb, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.solar_apply_obstacle(
  _company_id uuid,
  _model_id uuid,
  _expected_geometry_version integer,
  _obstacle jsonb,
  _delete_id uuid
)
RETURNS jsonb
RETURNS NULL ON NULL INPUT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _current_version integer;
  _obstacle_id uuid;
  _new_version integer;
  _hash text;
BEGIN
  IF NOT can_manage_company(_company_id, auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF _expected_geometry_version IS NULL THEN
    RAISE EXCEPTION 'expected_geometry_version_required';
  END IF;

  SELECT geometry_version INTO _current_version
  FROM public.solar_models
  WHERE id = _model_id AND company_id = _company_id
  FOR UPDATE;

  IF _current_version IS NULL THEN
    RAISE EXCEPTION 'model_not_found';
  END IF;

  IF _current_version <> _expected_geometry_version THEN
    RAISE EXCEPTION 'stale_geometry_version';
  END IF;

  IF _delete_id IS NOT NULL THEN
    DELETE FROM public.solar_obstacles
    WHERE id = _delete_id AND model_id = _model_id AND company_id = _company_id;
    _obstacle_id := _delete_id;
  ELSE
    IF _obstacle IS NULL THEN
      RAISE EXCEPTION 'obstacle_payload_required';
    END IF;

    IF NULLIF(_obstacle->>'id','') IS NOT NULL THEN
      UPDATE public.solar_obstacles
      SET roof_plane_id = NULLIF(_obstacle->>'roof_plane_id','')::uuid,
          obstacle_type = _obstacle->>'obstacle_type',
          label = COALESCE(_obstacle->>'label',''),
          position_x_m = (_obstacle->>'position_x_m')::numeric,
          position_y_m = (_obstacle->>'position_y_m')::numeric,
          base_z_m = COALESCE((_obstacle->>'base_z_m')::numeric, 0),
          width_m = (_obstacle->>'width_m')::numeric,
          length_m = (_obstacle->>'length_m')::numeric,
          height_m = (_obstacle->>'height_m')::numeric,
          rotation_deg = COALESCE((_obstacle->>'rotation_deg')::numeric, 0),
          clearance_m = COALESCE((_obstacle->>'clearance_m')::numeric, 0.3),
          casts_shadow = COALESCE((_obstacle->>'casts_shadow')::boolean, true),
          data_source = COALESCE(_obstacle->>'data_source','manuel'),
          updated_at = now()
      WHERE id = (_obstacle->>'id')::uuid
        AND model_id = _model_id
        AND company_id = _company_id
      RETURNING id INTO _obstacle_id;

      IF _obstacle_id IS NULL THEN
        RAISE EXCEPTION 'obstacle_not_found';
      END IF;
    ELSE
      INSERT INTO public.solar_obstacles (
        company_id, model_id, roof_plane_id, obstacle_type, label,
        position_x_m, position_y_m, base_z_m, width_m, length_m, height_m,
        rotation_deg, clearance_m, casts_shadow, data_source
      ) VALUES (
        _company_id, _model_id,
        NULLIF(_obstacle->>'roof_plane_id','')::uuid,
        _obstacle->>'obstacle_type',
        COALESCE(_obstacle->>'label',''),
        (_obstacle->>'position_x_m')::numeric,
        (_obstacle->>'position_y_m')::numeric,
        COALESCE((_obstacle->>'base_z_m')::numeric, 0),
        (_obstacle->>'width_m')::numeric,
        (_obstacle->>'length_m')::numeric,
        (_obstacle->>'height_m')::numeric,
        COALESCE((_obstacle->>'rotation_deg')::numeric, 0),
        COALESCE((_obstacle->>'clearance_m')::numeric, 0.3),
        COALESCE((_obstacle->>'casts_shadow')::boolean, true),
        COALESCE(_obstacle->>'data_source','manuel')
      )
      RETURNING id INTO _obstacle_id;
    END IF;
  END IF;

  SELECT md5(COALESCE(string_agg(
    o.id::text || ':' || o.obstacle_type || ':' || o.position_x_m || ':' || o.position_y_m || ':' ||
    o.width_m || ':' || o.length_m || ':' || o.height_m, '|' ORDER BY o.id
  ), 'none')) INTO _hash
  FROM public.solar_obstacles o
  WHERE o.model_id = _model_id AND o.company_id = _company_id;

  _new_version := _current_version + 1;
  UPDATE public.solar_models
  SET geometry_version = _new_version,
      geometry_hash = _hash,
      updated_by = auth.uid(),
      updated_at = now()
  WHERE id = _model_id AND company_id = _company_id;

  RETURN jsonb_build_object('geometry_version', _new_version, 'obstacle_id', _obstacle_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.solar_apply_obstacle(uuid, uuid, integer, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.solar_apply_obstacle(uuid, uuid, integer, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.solar_apply_obstacle(uuid, uuid, integer, jsonb, uuid) TO service_role;
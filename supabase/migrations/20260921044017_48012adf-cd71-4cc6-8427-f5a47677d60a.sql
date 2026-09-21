-- 1) Empreinte géométrique unique et canonique
CREATE OR REPLACE FUNCTION public.solar_geometry_fingerprint(_company_id uuid, _model_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT md5(
    jsonb_build_object(
      'origin', COALESCE((
        SELECT jsonb_build_object(
          'lat', m.origin_latitude,
          'lon', m.origin_longitude,
          'alt', m.origin_altitude_m
        )
        FROM public.solar_models m
        WHERE m.id = _model_id AND m.company_id = _company_id
      ), 'null'::jsonb),
      'building', COALESCE((
        SELECT jsonb_build_object(
          'mode', b.geometry_mode,
          'roof_type', b.roof_type,
          'rotation_deg', b.rotation_deg,
          'wall_height_m', b.wall_height_m,
          'params', COALESCE(b.params, '{}'::jsonb),
          'custom_planes', COALESCE(b.custom_planes, '[]'::jsonb),
          'terrain', COALESCE(b.terrain, 'null'::jsonb)
        )
        FROM public.solar_buildings b
        WHERE b.model_id = _model_id AND b.company_id = _company_id
        ORDER BY b.created_at
        LIMIT 1
      ), 'null'::jsonb),
      'planes', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'key', COALESCE(p.polygon->>'key', p.id::text),
          'name', p.name,
          'azimuth_deg', p.azimuth_deg,
          'tilt_deg', p.tilt_deg,
          'area_m2', p.area_m2,
          'eave_height_m', p.eave_height_m,
          'ridge_height_m', p.ridge_height_m,
          'polygon', COALESCE(p.polygon, 'null'::jsonb)
        ) ORDER BY COALESCE(p.polygon->>'key', p.id::text))
        FROM public.solar_roof_planes p
        WHERE p.model_id = _model_id AND p.company_id = _company_id
      ), '[]'::jsonb),
      'obstacles', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', o.id,
          'type', o.obstacle_type,
          'roof_plane_id', o.roof_plane_id,
          'x', o.position_x_m,
          'y', o.position_y_m,
          'z', o.base_z_m,
          'w', o.width_m,
          'l', o.length_m,
          'h', o.height_m,
          'rot', o.rotation_deg,
          'clearance', o.clearance_m
        ) ORDER BY o.id)
        FROM public.solar_obstacles o
        WHERE o.model_id = _model_id AND o.company_id = _company_id
      ), '[]'::jsonb)
    )::text
  );
$$;

REVOKE ALL ON FUNCTION public.solar_geometry_fingerprint(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.solar_geometry_fingerprint(uuid, uuid) TO authenticated, service_role;

-- 2) Garde-fou structurel sur un jeu de pans envoyé à un RPC
CREATE OR REPLACE FUNCTION public.solar_assert_planes_payload(_planes jsonb, _custom_planes jsonb)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  _p jsonb;
  _pt jsonb;
  _n integer;
  _num numeric;
BEGIN
  IF _planes IS NULL OR jsonb_typeof(_planes) <> 'array' THEN
    RAISE EXCEPTION 'invalid_planes_payload';
  END IF;
  IF _custom_planes IS NOT NULL AND jsonb_typeof(_custom_planes) NOT IN ('array', 'null') THEN
    RAISE EXCEPTION 'invalid_custom_planes_payload';
  END IF;
  IF jsonb_array_length(_planes) > 30 THEN
    RAISE EXCEPTION 'too_many_planes';
  END IF;

  IF (SELECT count(DISTINCT value->>'key') FROM jsonb_array_elements(_planes))
     <> jsonb_array_length(_planes) THEN
    RAISE EXCEPTION 'duplicate_plane_key';
  END IF;

  FOR _p IN SELECT * FROM jsonb_array_elements(_planes)
  LOOP
    IF COALESCE(_p->>'key', '') = '' THEN
      RAISE EXCEPTION 'plane_key_required';
    END IF;
    IF jsonb_typeof(_p->'polygon') <> 'object' THEN
      RAISE EXCEPTION 'plane_polygon_required';
    END IF;

    BEGIN
      _num := (_p->>'area_m2')::numeric;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'plane_area_invalid';
    END;
    IF _num IS NULL OR _num <= 0 OR _num > 1000000 THEN
      RAISE EXCEPTION 'plane_area_invalid';
    END IF;

    BEGIN
      _num := (_p->>'tilt_deg')::numeric;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'plane_tilt_invalid';
    END;
    IF _num IS NULL OR _num < 0 OR _num > 70 THEN
      RAISE EXCEPTION 'plane_tilt_invalid';
    END IF;

    BEGIN
      _num := (_p->>'azimuth_deg')::numeric;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'plane_azimuth_invalid';
    END;
    IF _num IS NULL OR _num < -360 OR _num > 360 THEN
      RAISE EXCEPTION 'plane_azimuth_invalid';
    END IF;
  END LOOP;

  IF _custom_planes IS NOT NULL AND jsonb_typeof(_custom_planes) = 'array' THEN
    FOR _p IN SELECT * FROM jsonb_array_elements(_custom_planes)
    LOOP
      IF COALESCE(_p->>'key', '') = '' THEN
        RAISE EXCEPTION 'plane_key_required';
      END IF;
      IF jsonb_typeof(_p->'ring') <> 'array' THEN
        RAISE EXCEPTION 'plane_ring_invalid';
      END IF;
      _n := jsonb_array_length(_p->'ring');
      IF _n < 3 OR _n > 60 THEN
        RAISE EXCEPTION 'plane_ring_invalid';
      END IF;
      FOR _pt IN SELECT * FROM jsonb_array_elements(_p->'ring')
      LOOP
        IF jsonb_typeof(_pt->'x') <> 'number' OR jsonb_typeof(_pt->'y') <> 'number' THEN
          RAISE EXCEPTION 'plane_ring_invalid';
        END IF;
        IF (_pt->>'x')::numeric < -2000 OR (_pt->>'x')::numeric > 2000
           OR (_pt->>'y')::numeric < -2000 OR (_pt->>'y')::numeric > 2000 THEN
          RAISE EXCEPTION 'plane_ring_invalid';
        END IF;
      END LOOP;
    END LOOP;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.solar_assert_planes_payload(jsonb, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.solar_assert_planes_payload(jsonb, jsonb) TO authenticated, service_role;

-- 3) RPC toiture durci
CREATE OR REPLACE FUNCTION public.solar_apply_roof_geometry(_company_id uuid, _model_id uuid, _expected_geometry_version integer, _mode text, _allow_mode_switch boolean, _custom_planes jsonb, _planes jsonb)
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
  _payload_keys text[];
  _existing_keys text[];
  _kept integer := 0;
  _deleted integer := 0;
  _new_version integer;
  _hash text;
  _converting boolean := false;
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

  PERFORM public.solar_assert_planes_payload(_planes, _custom_planes);

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

  IF _mode = 'parametric' AND _building.geometry_mode = 'polygon' THEN
    RAISE EXCEPTION 'polygon_mode_is_final';
  END IF;

  IF _mode = 'polygon' AND _building.geometry_mode <> 'polygon' THEN
    IF NOT COALESCE(_allow_mode_switch, false) THEN
      RAISE EXCEPTION 'conversion_required';
    END IF;
    _converting := true;

    SELECT array_agg(value->>'key' ORDER BY value->>'key')
      INTO _payload_keys
      FROM jsonb_array_elements(_planes);

    SELECT array_agg(k ORDER BY k) INTO _existing_keys
      FROM (
        SELECT COALESCE(polygon->>'key', '') AS k
        FROM public.solar_roof_planes
        WHERE model_id = _model_id AND company_id = _company_id
      ) s;

    -- La conversion explicite ne peut ni ajouter, ni retirer, ni renommer un pan.
    IF _existing_keys IS NULL
       OR _payload_keys IS NULL
       OR _payload_keys <> _existing_keys THEN
      RAISE EXCEPTION 'conversion_key_mismatch';
    END IF;
  END IF;

  UPDATE public.solar_buildings
  SET geometry_mode = _mode,
      custom_planes = COALESCE(_custom_planes, '[]'::jsonb),
      updated_at = now()
  WHERE id = _building.id AND company_id = _company_id;

  FOR _plane IN SELECT * FROM jsonb_array_elements(COALESCE(_planes, '[]'::jsonb))
  LOOP
    _keys := _keys || (_plane->>'key');

    SELECT id INTO _plane_id
    FROM public.solar_roof_planes
    WHERE model_id = _model_id
      AND company_id = _company_id
      AND polygon->>'key' = _plane->>'key'
    LIMIT 1;

    IF _plane_id IS NULL THEN
      IF _converting THEN
        -- Impossible en théorie (clés vérifiées), garde-fou de dernier recours.
        RAISE EXCEPTION 'conversion_key_mismatch';
      END IF;
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

  IF NOT _converting THEN
    WITH removed AS (
      DELETE FROM public.solar_roof_planes
      WHERE model_id = _model_id
        AND company_id = _company_id
        AND COALESCE(polygon->>'key', '') <> ALL (_keys)
      RETURNING 1
    )
    SELECT count(*) INTO _deleted FROM removed;
  END IF;

  _hash := public.solar_geometry_fingerprint(_company_id, _model_id);

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

-- 4) RPC obstacle durci
CREATE OR REPLACE FUNCTION public.solar_apply_obstacle(_company_id uuid, _model_id uuid, _expected_geometry_version integer, _obstacle jsonb, _delete_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
CALLED ON NULL INPUT
SET search_path TO 'public'
AS $function$
DECLARE
  _current_version integer;
  _obstacle_id uuid;
  _new_version integer;
  _hash text;
  _plane_id uuid;
  _type text;
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
    IF _obstacle IS NULL OR _obstacle = 'null'::jsonb OR jsonb_typeof(_obstacle) <> 'object' THEN
      RAISE EXCEPTION 'obstacle_payload_required';
    END IF;

    _type := _obstacle->>'obstacle_type';
    IF _type IS NULL OR _type NOT IN (
      'cheminee','velux','chien_assis','antenne','climatisation','ventilation',
      'arbre','batiment_voisin','mur','poteau','autre'
    ) THEN
      RAISE EXCEPTION 'invalid_obstacle_type';
    END IF;

    _plane_id := NULLIF(_obstacle->>'roof_plane_id','')::uuid;
    IF _plane_id IS NOT NULL THEN
      PERFORM 1 FROM public.solar_roof_planes
      WHERE id = _plane_id AND model_id = _model_id AND company_id = _company_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'roof_plane_not_found';
      END IF;
    END IF;

    IF (_obstacle->>'position_x_m')::numeric IS NULL
       OR (_obstacle->>'position_y_m')::numeric IS NULL
       OR (_obstacle->>'width_m')::numeric IS NULL
       OR (_obstacle->>'length_m')::numeric IS NULL
       OR (_obstacle->>'height_m')::numeric IS NULL THEN
      RAISE EXCEPTION 'obstacle_payload_required';
    END IF;

    IF (_obstacle->>'width_m')::numeric <= 0
       OR (_obstacle->>'length_m')::numeric <= 0
       OR (_obstacle->>'width_m')::numeric > 200
       OR (_obstacle->>'length_m')::numeric > 200
       OR (_obstacle->>'height_m')::numeric < 0
       OR (_obstacle->>'height_m')::numeric > 200
       OR abs((_obstacle->>'position_x_m')::numeric) > 2000
       OR abs((_obstacle->>'position_y_m')::numeric) > 2000 THEN
      RAISE EXCEPTION 'obstacle_bounds_invalid';
    END IF;

    IF NULLIF(_obstacle->>'id','') IS NOT NULL THEN
      UPDATE public.solar_obstacles
      SET roof_plane_id = _plane_id,
          obstacle_type = _type,
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
        _company_id, _model_id, _plane_id, _type,
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

  _hash := public.solar_geometry_fingerprint(_company_id, _model_id);

  _new_version := _current_version + 1;
  UPDATE public.solar_models
  SET geometry_version = _new_version,
      geometry_hash = _hash,
      updated_by = auth.uid(),
      updated_at = now()
  WHERE id = _model_id AND company_id = _company_id;

  RETURN jsonb_build_object('geometry_version', _new_version, 'obstacle_id', _obstacle_id, 'geometry_hash', _hash);
END;
$function$;

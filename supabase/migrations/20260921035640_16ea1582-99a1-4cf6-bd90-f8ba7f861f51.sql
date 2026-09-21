CREATE OR REPLACE FUNCTION public.solar_apply_obstacle(
  _company_id uuid,
  _model_id uuid,
  _expected_geometry_version integer,
  _obstacle jsonb,
  _delete_id uuid
)
RETURNS jsonb
CALLED ON NULL INPUT
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
    IF _obstacle IS NULL OR _obstacle = 'null'::jsonb THEN
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
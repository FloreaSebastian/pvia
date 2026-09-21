CREATE OR REPLACE FUNCTION public.solar_geometry_fingerprint(_company_id uuid, _model_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
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

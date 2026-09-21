-- P0-C.2 : fermeture de l'ancien contrat d'application d'implantation.
-- 1) une seule signature officielle ; 2) version de géométrie obligatoire ;
-- 3) validation structurelle AVANT toute suppression ; 4) droits resserrés.

DROP FUNCTION IF EXISTS public.solar_apply_layout(uuid, uuid, integer, jsonb);

CREATE OR REPLACE FUNCTION public.solar_apply_layout(
  _company_id uuid,
  _model_id uuid,
  _expected_geometry_version integer,
  _arrays jsonb,
  _variant jsonb DEFAULT NULL::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _current_version integer;
  _array jsonb;
  _array_id uuid;
  _plane_id uuid;
  _module jsonb;
  _modules jsonb;
  _index integer;
  _total integer := 0;
  _check_total integer := 0;
  _variant_id uuid := NULL;
  _num jsonb;
BEGIN
  IF NOT can_manage_company(_company_id, auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- La version de toiture attendue n'est jamais optionnelle : NULL ne doit pas
  -- servir de contournement du contrôle d'obsolescence.
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

  IF _expected_geometry_version <> _current_version THEN
    RAISE EXCEPTION 'stale_geometry_version';
  END IF;

  ----------------------------------------------------------------------------
  -- Validation structurelle : la fonction est SECURITY DEFINER et appelable
  -- directement ; un appel brut ne doit pas pouvoir écrire du JSON grossier.
  -- La validation géométrique complète reste côté serveur applicatif (jeton
  -- de calcul + rejeu du moteur) : ici on ferme les contournements évidents.
  ----------------------------------------------------------------------------
  IF _arrays IS NULL OR jsonb_typeof(_arrays) <> 'array' THEN
    RAISE EXCEPTION 'invalid_arrays_payload';
  END IF;

  IF jsonb_array_length(_arrays) > 12 THEN
    RAISE EXCEPTION 'too_many_arrays';
  END IF;

  FOR _array IN SELECT * FROM jsonb_array_elements(_arrays)
  LOOP
    IF jsonb_typeof(_array) <> 'object' THEN
      RAISE EXCEPTION 'invalid_array_entry';
    END IF;

    IF NULLIF(_array->>'roof_plane_id','') IS NULL THEN
      RAISE EXCEPTION 'invalid_array_plane';
    END IF;

    IF COALESCE(_array->>'orientation','portrait') NOT IN ('portrait','paysage') THEN
      RAISE EXCEPTION 'invalid_orientation';
    END IF;

    IF NULLIF(_array->>'module_variant_id','') IS NULL THEN
      RAISE EXCEPTION 'invalid_module_variant';
    END IF;

    IF _array ? 'module_snapshot'
       AND jsonb_typeof(_array->'module_snapshot') NOT IN ('object','null') THEN
      RAISE EXCEPTION 'invalid_module_snapshot';
    END IF;

    IF _array ? 'params' AND jsonb_typeof(_array->'params') <> 'object' THEN
      RAISE EXCEPTION 'invalid_array_params';
    END IF;

    _modules := COALESCE(_array->'modules', '[]'::jsonb);
    IF jsonb_typeof(_modules) <> 'array' THEN
      RAISE EXCEPTION 'invalid_modules_payload';
    END IF;

    _check_total := _check_total + jsonb_array_length(_modules);
    IF _check_total > 2000 THEN
      RAISE EXCEPTION 'too_many_modules';
    END IF;

    FOR _module IN SELECT * FROM jsonb_array_elements(_modules)
    LOOP
      IF jsonb_typeof(_module) <> 'object' THEN
        RAISE EXCEPTION 'invalid_module_entry';
      END IF;

      IF COALESCE(_module->>'orientation','portrait') NOT IN ('portrait','paysage') THEN
        RAISE EXCEPTION 'invalid_orientation';
      END IF;

      IF _module ? 'enabled' AND jsonb_typeof(_module->'enabled') <> 'boolean' THEN
        RAISE EXCEPTION 'invalid_module_enabled';
      END IF;

      FOREACH _num IN ARRAY ARRAY[_module->'local_u_m', _module->'local_v_m']
      LOOP
        IF _num IS NULL OR jsonb_typeof(_num) <> 'number' THEN
          RAISE EXCEPTION 'invalid_module_position';
        END IF;
        IF NOT ((_num#>>'{}')::numeric BETWEEN -2000 AND 2000) THEN
          RAISE EXCEPTION 'invalid_module_position';
        END IF;
      END LOOP;

      IF _module ? 'grid_row' AND jsonb_typeof(_module->'grid_row') NOT IN ('number','null') THEN
        RAISE EXCEPTION 'invalid_module_grid';
      END IF;
      IF _module ? 'grid_col' AND jsonb_typeof(_module->'grid_col') NOT IN ('number','null') THEN
        RAISE EXCEPTION 'invalid_module_grid';
      END IF;
    END LOOP;
  END LOOP;

  IF _variant IS NOT NULL AND jsonb_typeof(_variant) <> 'null' THEN
    IF jsonb_typeof(_variant) <> 'object' THEN
      RAISE EXCEPTION 'invalid_variant_payload';
    END IF;
    IF jsonb_typeof(COALESCE(_variant->'modules','[]'::jsonb)) <> 'array' THEN
      RAISE EXCEPTION 'invalid_variant_modules';
    END IF;
    IF COALESCE((_variant->>'module_count')::integer, -1)
       <> jsonb_array_length(COALESCE(_variant->'modules','[]'::jsonb)) THEN
      RAISE EXCEPTION 'invalid_variant_module_count';
    END IF;
    IF COALESCE(NULLIF(_variant->>'layout_engine_version',''), '') = '' THEN
      RAISE EXCEPTION 'invalid_variant_engine_version';
    END IF;
    IF _variant ? 'rules_snapshot' AND jsonb_typeof(_variant->'rules_snapshot') <> 'object' THEN
      RAISE EXCEPTION 'invalid_variant_rules_snapshot';
    END IF;
  END IF;

  ----------------------------------------------------------------------------
  -- Écriture : variante + champs + panneaux dans la MÊME transaction.
  ----------------------------------------------------------------------------
  IF _variant IS NOT NULL AND jsonb_typeof(_variant) = 'object' THEN
    INSERT INTO public.solar_layout_variants (
      company_id, model_id, geometry_version, label, strategy, orientation_mode,
      target_mode, target_power_kwc, module_variant_id, module_snapshot,
      rules_profile_id, rules_profile_version, rules_snapshot,
      layout_engine_version, module_count, power_kwc, criteria, modules, created_by
    )
    VALUES (
      _company_id, _model_id, _current_version,
      COALESCE(_variant->>'label', 'Implantation'),
      COALESCE(_variant->>'strategy', 'equilibre'),
      COALESCE(_variant->>'orientation_mode', 'auto'),
      COALESCE(_variant->>'target_mode', 'max'),
      NULLIF(_variant->>'target_power_kwc','')::numeric,
      NULLIF(_variant->>'module_variant_id','')::uuid,
      _variant->'module_snapshot',
      NULLIF(_variant->>'rules_profile_id','')::uuid,
      NULLIF(_variant->>'rules_profile_version','')::integer,
      COALESCE(_variant->'rules_snapshot', '{}'::jsonb),
      COALESCE(_variant->>'layout_engine_version', 'inconnue'),
      COALESCE((_variant->>'module_count')::integer, 0),
      COALESCE((_variant->>'power_kwc')::numeric, 0),
      COALESCE(_variant->'criteria', '{}'::jsonb),
      COALESCE(_variant->'modules', '[]'::jsonb),
      auth.uid()
    )
    RETURNING id INTO _variant_id;
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
      row_gap_m, col_gap_m, params, rules_profile_id, rules_profile_version, layout_engine_version,
      module_variant_id, module_revision_id, module_snapshot
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
      _array->>'layout_engine_version',
      NULLIF(_array->>'module_variant_id','')::uuid,
      NULLIF(_array->>'module_revision_id','')::uuid,
      _array->'module_snapshot'
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
        COALESCE(_variant_id, NULLIF(_array->>'variant_id','')::uuid)
      );
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'modules', _total,
    'geometry_version', _current_version,
    'variant_id', _variant_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.solar_apply_layout(uuid, uuid, integer, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.solar_apply_layout(uuid, uuid, integer, jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.solar_apply_layout(uuid, uuid, integer, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.solar_apply_layout(uuid, uuid, integer, jsonb, jsonb) TO service_role;
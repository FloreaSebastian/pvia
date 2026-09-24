
ALTER TABLE public.solar_models ADD COLUMN IF NOT EXISTS layout_version integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.solar_layout_fingerprint(_company_id uuid, _model_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT md5(
    coalesce((SELECT string_agg(concat_ws('|', a.id, a.roof_plane_id, a.module_variant_id, a.module_revision_id,
        a.rules_profile_id, a.rules_profile_version, a.layout_engine_version, a.orientation, a.module_snapshot::text),
        ';' ORDER BY a.id) FROM solar_arrays a WHERE a.company_id=_company_id AND a.model_id=_model_id), '')
    || '#' ||
    coalesce((SELECT string_agg(concat_ws('|', m.id, m.array_id, m.roof_plane_id,
        round(m.local_u_m::numeric, 6), round(m.local_v_m::numeric, 6), m.orientation, m.enabled),
        ';' ORDER BY m.id) FROM solar_modules_placed m WHERE m.company_id=_company_id AND m.model_id=_model_id), '')
  );
$$;
REVOKE ALL ON FUNCTION public.solar_layout_fingerprint(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.solar_layout_fingerprint(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.solar_bump_layout_version()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE solar_models s SET layout_version = s.layout_version + 1
     WHERE s.id IN (SELECT DISTINCT model_id FROM old_rows);
  ELSE
    UPDATE solar_models s SET layout_version = s.layout_version + 1
     WHERE s.id IN (SELECT DISTINCT model_id FROM new_rows);
  END IF;
  RETURN NULL;
END; $$;

CREATE TRIGGER solar_arrays_layout_ins AFTER INSERT ON public.solar_arrays REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.solar_bump_layout_version();
CREATE TRIGGER solar_arrays_layout_upd AFTER UPDATE ON public.solar_arrays REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.solar_bump_layout_version();
CREATE TRIGGER solar_arrays_layout_del AFTER DELETE ON public.solar_arrays REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.solar_bump_layout_version();
CREATE TRIGGER solar_modules_layout_ins AFTER INSERT ON public.solar_modules_placed REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.solar_bump_layout_version();
CREATE TRIGGER solar_modules_layout_upd AFTER UPDATE ON public.solar_modules_placed REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.solar_bump_layout_version();
CREATE TRIGGER solar_modules_layout_del AFTER DELETE ON public.solar_modules_placed REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.solar_bump_layout_version();

-- Catalogue onduleurs
CREATE TABLE public.solar_inverters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  manufacturer text NOT NULL,
  series text,
  model text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('string','hybride','micro')),
  source_type text NOT NULL CHECK (source_type IN ('manuel','base_officielle','fiche_constructeur')),
  archived boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.solar_inverter_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inverter_id uuid NOT NULL REFERENCES public.solar_inverters(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  revision_number integer NOT NULL DEFAULT 1,
  is_current boolean NOT NULL DEFAULT true,
  ac_power_w numeric, phase text CHECK (phase IS NULL OR phase IN ('mono','tri')),
  mppt_count integer, inputs_per_mppt integer,
  vdc_max_v numeric, mppt_vmin_v numeric, mppt_vmax_v numeric, start_voltage_v numeric,
  imax_mppt_a numeric, imax_input_a numeric, isc_max_mppt_a numeric,
  dc_power_max_w numeric, dc_ac_ratio_max numeric,
  micro_inputs integer, micro_input_vmax_v numeric, micro_input_imax_a numeric,
  micro_input_isc_max_a numeric, micro_input_power_max_w numeric,
  provenance text NOT NULL, datasheet_url text, datasheet_version text,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (inverter_id, revision_number)
);
GRANT SELECT ON public.solar_inverters, public.solar_inverter_revisions TO authenticated;
GRANT ALL ON public.solar_inverters, public.solar_inverter_revisions TO service_role;
ALTER TABLE public.solar_inverters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solar_inverter_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "inverters readable" ON public.solar_inverters FOR SELECT TO authenticated
  USING (company_id IS NULL OR is_company_member(company_id, auth.uid()));
CREATE POLICY "inverter revisions readable" ON public.solar_inverter_revisions FOR SELECT TO authenticated
  USING (company_id IS NULL OR is_company_member(company_id, auth.uid()));
CREATE TRIGGER solar_inverters_touch BEFORE UPDATE ON public.solar_inverters FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Conception électrique
CREATE TABLE public.solar_electrical_designs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  model_id uuid NOT NULL REFERENCES public.solar_models(id) ON DELETE CASCADE,
  is_current boolean NOT NULL DEFAULT true,
  topology text NOT NULL CHECK (topology IN ('string','hybride','micro')),
  inverter_id uuid REFERENCES public.solar_inverters(id) ON DELETE SET NULL,
  inverter_revision_id uuid REFERENCES public.solar_inverter_revisions(id) ON DELETE SET NULL,
  inverter_snapshot jsonb NOT NULL,
  inverter_count integer NOT NULL DEFAULT 1,
  module_electrical_snapshot jsonb NOT NULL,
  temp_min_c numeric NOT NULL, temp_max_c numeric NOT NULL, temp_source text NOT NULL,
  geometry_version integer NOT NULL, geometry_hash text,
  layout_version integer NOT NULL, layout_hash text NOT NULL,
  engine_version text NOT NULL, signature text NOT NULL,
  status text NOT NULL, variant_label text,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb, warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.solar_electrical_designs (model_id, is_current);
CREATE TABLE public.solar_electrical_strings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  design_id uuid NOT NULL REFERENCES public.solar_electrical_designs(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('string','micro')),
  label text NOT NULL, inverter_index integer NOT NULL DEFAULT 0,
  mppt_index integer, input_index integer, position integer NOT NULL,
  module_count integer NOT NULL, results jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE public.solar_electrical_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  design_id uuid NOT NULL REFERENCES public.solar_electrical_designs(id) ON DELETE CASCADE,
  string_id uuid NOT NULL REFERENCES public.solar_electrical_strings(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  module_id uuid NOT NULL, position integer NOT NULL,
  UNIQUE (design_id, module_id)
);
GRANT SELECT ON public.solar_electrical_designs, public.solar_electrical_strings, public.solar_electrical_assignments TO authenticated;
GRANT ALL ON public.solar_electrical_designs, public.solar_electrical_strings, public.solar_electrical_assignments TO service_role;
ALTER TABLE public.solar_electrical_designs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solar_electrical_strings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solar_electrical_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "designs member read" ON public.solar_electrical_designs FOR SELECT TO authenticated USING (is_company_member(company_id, auth.uid()));
CREATE POLICY "strings member read" ON public.solar_electrical_strings FOR SELECT TO authenticated USING (is_company_member(company_id, auth.uid()));
CREATE POLICY "assignments member read" ON public.solar_electrical_assignments FOR SELECT TO authenticated USING (is_company_member(company_id, auth.uid()));

-- Référence manuelle entreprise (identité + révision atomiques)
CREATE OR REPLACE FUNCTION public.solar_create_manual_inverter(_company_id uuid, _inverter jsonb, _spec jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _id uuid;
  FUNCTION_NUM text;
BEGIN
  IF NOT can_manage_company(_company_id, auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT company_has_write_access(_company_id) THEN RAISE EXCEPTION 'subscription_unusable'; END IF;
  IF coalesce(trim(_inverter->>'manufacturer'),'') = '' OR coalesce(trim(_inverter->>'model'),'') = '' THEN
    RAISE EXCEPTION 'invalid_inverter_identity'; END IF;
  IF coalesce(_inverter->>'kind','') NOT IN ('string','hybride','micro') THEN RAISE EXCEPTION 'invalid_inverter_kind'; END IF;
  IF coalesce(trim(_spec->>'provenance'),'') = '' THEN RAISE EXCEPTION 'provenance_required'; END IF;
  INSERT INTO solar_inverters (company_id, manufacturer, series, model, kind, source_type, created_by)
  VALUES (_company_id, trim(_inverter->>'manufacturer'), nullif(trim(_inverter->>'series'),''),
          trim(_inverter->>'model'), _inverter->>'kind', 'manuel', auth.uid())
  RETURNING id INTO _id;
  INSERT INTO solar_inverter_revisions (inverter_id, company_id, revision_number, ac_power_w, phase, mppt_count,
    inputs_per_mppt, vdc_max_v, mppt_vmin_v, mppt_vmax_v, start_voltage_v, imax_mppt_a, imax_input_a,
    isc_max_mppt_a, dc_power_max_w, dc_ac_ratio_max, micro_inputs, micro_input_vmax_v, micro_input_imax_a,
    micro_input_isc_max_a, micro_input_power_max_w, provenance, datasheet_url, datasheet_version, created_by)
  VALUES (_id, _company_id, 1,
    nullif(_spec->>'ac_power_w','')::numeric, nullif(_spec->>'phase',''),
    nullif(_spec->>'mppt_count','')::integer, nullif(_spec->>'inputs_per_mppt','')::integer,
    nullif(_spec->>'vdc_max_v','')::numeric, nullif(_spec->>'mppt_vmin_v','')::numeric,
    nullif(_spec->>'mppt_vmax_v','')::numeric, nullif(_spec->>'start_voltage_v','')::numeric,
    nullif(_spec->>'imax_mppt_a','')::numeric, nullif(_spec->>'imax_input_a','')::numeric,
    nullif(_spec->>'isc_max_mppt_a','')::numeric, nullif(_spec->>'dc_power_max_w','')::numeric,
    nullif(_spec->>'dc_ac_ratio_max','')::numeric, nullif(_spec->>'micro_inputs','')::integer,
    nullif(_spec->>'micro_input_vmax_v','')::numeric, nullif(_spec->>'micro_input_imax_a','')::numeric,
    nullif(_spec->>'micro_input_isc_max_a','')::numeric, nullif(_spec->>'micro_input_power_max_w','')::numeric,
    trim(_spec->>'provenance'), nullif(_spec->>'datasheet_url',''), nullif(_spec->>'datasheet_version',''), auth.uid());
  RETURN _id;
END; $$;
REVOKE ALL ON FUNCTION public.solar_create_manual_inverter(uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.solar_create_manual_inverter(uuid, jsonb, jsonb) TO authenticated, service_role;

-- Enregistrement atomique d'une conception électrique
CREATE OR REPLACE FUNCTION public.solar_apply_electrical_design(
  _company_id uuid, _model_id uuid, _expected_geometry_version integer,
  _expected_layout_version integer, _expected_layout_hash text, _design jsonb, _strings jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _geo integer; _lv integer; _design_id uuid; _s jsonb; _sid uuid; _mid text; _pos integer;
  _spos integer := 0; _total integer := 0; _seen uuid[] := '{}';
BEGIN
  IF NOT can_manage_company(_company_id, auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
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
    _design->>'engine_version', _design->>'signature', coalesce(_design->>'status','non_verifiable'),
    nullif(_design->>'variant_label',''), coalesce(_design->'summary','{}'::jsonb),
    coalesce(_design->'warnings','[]'::jsonb), auth.uid())
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
REVOKE ALL ON FUNCTION public.solar_apply_electrical_design(uuid, uuid, integer, integer, text, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.solar_apply_electrical_design(uuid, uuid, integer, integer, text, jsonb, jsonb) TO authenticated, service_role;

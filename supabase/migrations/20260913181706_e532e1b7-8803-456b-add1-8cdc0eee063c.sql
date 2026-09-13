
create or replace function public.solar_catalog_apply_import(_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  _src text;
  _manufacturers int := 0;
  _series int := 0;
  _variants int := 0;
begin
  select source into _src from public.solar_catalog_jobs where id = _job_id;
  if _src is null then raise exception 'unknown_job'; end if;

  with ins as (
    insert into public.solar_manufacturers (name)
    select distinct btrim(manufacturer) from public.solar_catalog_import_rows where job_id = _job_id
    on conflict (name_normalized) do nothing
    returning 1
  ) select count(*) into _manufacturers from ins;

  with rows_x as (
    select
      mf.id as manufacturer_id,
      coalesce(nullif(btrim(r.family), ''), btrim(r.model)) as series_family,
      case when r.short_side_m is not null then round(r.short_side_m * 1000)::int end as width_mm,
      case when r.long_side_m is not null then round(r.long_side_m * 1000)::int end as height_mm,
      r.technology,
      max(r.cells_series * coalesce(r.cells_parallel, 1)) as cell_count
    from public.solar_catalog_import_rows r
    join public.solar_manufacturers mf
      on mf.name_normalized = public.solar_normalize_text(r.manufacturer)
    where r.job_id = _job_id
    group by 1,2,3,4,5
  ),
  labelled as (
    select rx.*,
      case
        when width_mm is null or height_mm is null then series_family || ' (dimensions non publiées)'
        when count(*) over (partition by manufacturer_id, series_family) > 1
          then series_family || ' (' || width_mm || '×' || height_mm || ' mm)'
        else series_family
      end as series_name
    from rows_x rx
  ),
  deduped as (
    select distinct on (manufacturer_id, public.solar_normalize_text(series_name))
      manufacturer_id, series_name, width_mm, height_mm, technology, cell_count
    from labelled
  ),
  ins as (
    insert into public.solar_module_series
      (manufacturer_id, name, width_mm, height_mm, technologies, cell_count)
    select manufacturer_id, series_name, width_mm, height_mm,
           case when technology is null then '{}'::text[] else array[technology] end,
           cell_count
    from deduped
    on conflict do nothing
    returning 1
  ) select count(*) into _series from ins;

  with rows_x as (
    select
      r.model, r.description, r.safety_certification,
      r.pmax_w, r.voc_v, r.vmp_v, r.isc_a, r.imp_a,
      r.tc_pmax, r.tc_voc, r.tc_isc, r.noct_c,
      mf.id as manufacturer_id,
      coalesce(nullif(btrim(r.family), ''), btrim(r.model)) as series_family,
      case when r.short_side_m is not null then round(r.short_side_m * 1000)::int end as width_mm,
      case when r.long_side_m is not null then round(r.long_side_m * 1000)::int end as height_mm
    from public.solar_catalog_import_rows r
    join public.solar_manufacturers mf
      on mf.name_normalized = public.solar_normalize_text(r.manufacturer)
    where r.job_id = _job_id and r.pmax_w is not null
  ),
  matched as (
    select rx.*, sr.id as series_id
    from rows_x rx
    join public.solar_module_series sr
      on sr.manufacturer_id = rx.manufacturer_id
     and sr.company_id is null
     and sr.width_mm is not distinct from rx.width_mm
     and sr.height_mm is not distinct from rx.height_mm
     and sr.name_normalized in (
          public.solar_normalize_text(rx.series_family),
          public.solar_normalize_text(rx.series_family || ' (dimensions non publiées)'),
          public.solar_normalize_text(rx.series_family || ' (' || rx.width_mm || '×' || rx.height_mm || ' mm)')
        )
  ),
  ins as (
    insert into public.solar_module_variants
      (series_id, model, model_original, pmax_stc_w, voc_v, vmp_v, isc_a, imp_a,
       temp_coeff_pmax_pct_per_c, temp_coeff_voc_pct_per_c, temp_coeff_isc_pct_per_c, noct_c,
       status, confidence, primary_source, source_ref, certifications, verified_at)
    select distinct on (series_id, public.solar_normalize_text(model), round(pmax_w)::int)
      series_id, btrim(model), btrim(model), round(pmax_w)::int,
      voc_v, vmp_v, isc_a, imp_a, tc_pmax, tc_voc, tc_isc, noct_c,
      'unknown', 'base_officielle', _src, nullif(btrim(coalesce(description,'')), ''),
      case when nullif(btrim(coalesce(safety_certification,'')),'') is null
           then '{}'::text[] else array[btrim(safety_certification)] end,
      now()
    from matched
    on conflict do nothing
    returning 1
  ) select count(*) into _variants from ins;

  with target as (
    select v.id, sr.width_mm, sr.height_mm, v.pmax_stc_w
    from public.solar_module_variants v
    join public.solar_module_series sr on sr.id = v.series_id
    where v.primary_source = _src and v.current_revision_id is null
  ),
  rev as (
    insert into public.solar_module_revisions
      (variant_id, revision_number, label, width_mm, height_mm, pmax_stc_w, source_type)
    select id, 1, 'Import ' || _src, width_mm, height_mm, pmax_stc_w, 'base_officielle'
    from target
    returning id, variant_id
  )
  update public.solar_module_variants v set current_revision_id = rev.id
  from rev where rev.variant_id = v.id;

  insert into public.solar_module_field_sources (variant_id, field, value_text, source_type, source_label, confidence)
  select v.id, f.field, f.value, 'base_officielle', _src, 'base_officielle'
  from public.solar_module_variants v
  join public.solar_module_series sr on sr.id = v.series_id
  cross join lateral (values
    ('width_mm', sr.width_mm::text),
    ('height_mm', sr.height_mm::text),
    ('pmax_stc_w', v.pmax_stc_w::text),
    ('voc_v', v.voc_v::text),
    ('vmp_v', v.vmp_v::text),
    ('isc_a', v.isc_a::text),
    ('imp_a', v.imp_a::text)
  ) as f(field, value)
  where v.primary_source = _src and f.value is not null
  on conflict (variant_id, field, source_type) do nothing;

  update public.solar_catalog_jobs
     set status = 'succeeded', finished_at = now(),
         stats = jsonb_build_object('manufacturers', _manufacturers, 'series', _series, 'variants', _variants)
   where id = _job_id;

  return jsonb_build_object('manufacturers', _manufacturers, 'series', _series, 'variants', _variants);
end $fn$;

revoke all on function public.solar_catalog_apply_import(uuid) from public, anon, authenticated;


create extension if not exists pg_trgm with schema public;

-- Normalisation partagée (recherche tolérante, détection de doublons)
create or replace function public.unaccent_safe(_t text)
returns text language sql immutable set search_path = public as $$
  select translate(coalesce(_t,''),
    'àâäáãåçéèêëíìîïñóòôöõúùûüýÿÀÂÄÁÃÅÇÉÈÊËÍÌÎÏÑÓÒÔÖÕÚÙÛÜÝ',
    'aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUY')
$$;

create or replace function public.solar_normalize_text(_t text)
returns text language sql immutable set search_path = public as $$
  select nullif(regexp_replace(lower(public.unaccent_safe(coalesce(_t,''))), '[^a-z0-9]+', '', 'g'), '')
$$;

/* ----------------------------- Fabricants ------------------------------- */
create table public.solar_manufacturers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_normalized text generated always as (public.solar_normalize_text(name)) stored,
  country text,
  website text,
  logo_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index solar_manufacturers_norm_uidx on public.solar_manufacturers(name_normalized);
create index solar_manufacturers_trgm_idx on public.solar_manufacturers using gin (name gin_trgm_ops);

grant select on public.solar_manufacturers to authenticated;
grant all on public.solar_manufacturers to service_role;
alter table public.solar_manufacturers enable row level security;
create policy "manufacturers_read" on public.solar_manufacturers for select to authenticated using (true);
create policy "manufacturers_admin" on public.solar_manufacturers for all to authenticated
  using (public.is_platform_admin(auth.uid())) with check (public.is_platform_admin(auth.uid()));
create trigger set_updated_at before update on public.solar_manufacturers
  for each row execute function public.set_updated_at();

/* ------------------------------- Séries --------------------------------- */
create table public.solar_module_series (
  id uuid primary key default gen_random_uuid(),
  manufacturer_id uuid not null references public.solar_manufacturers(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  name text not null,
  name_normalized text generated always as (public.solar_normalize_text(name)) stored,
  model_family text,
  height_mm integer check (height_mm is null or (height_mm between 200 and 6000)),
  width_mm integer check (width_mm is null or (width_mm between 200 and 3000)),
  depth_mm integer check (depth_mm is null or (depth_mm between 2 and 200)),
  weight_kg numeric(6,2) check (weight_kg is null or (weight_kg between 1 and 200)),
  technologies text[] not null default '{}',
  cell_count integer,
  half_cut boolean,
  cell_format text,
  cell_width_mm numeric(6,2),
  cell_height_mm numeric(6,2),
  busbars integer,
  cell_layout text,
  glass_type text,
  glass_thickness_mm numeric(4,2),
  frame_type text,
  frame_material text,
  frame_color text,
  backsheet_color text,
  junction_box text,
  ip_rating text,
  connector_type text,
  cable_length_mm integer,
  cable_section_mm2 numeric(4,2),
  bifacial boolean not null default false,
  bifaciality_factor numeric(4,3),
  clamp_zones jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index solar_module_series_global_uidx
  on public.solar_module_series(manufacturer_id, name_normalized) where company_id is null;
create unique index solar_module_series_company_uidx
  on public.solar_module_series(company_id, manufacturer_id, name_normalized) where company_id is not null;
create index solar_module_series_manufacturer_idx on public.solar_module_series(manufacturer_id);

grant select, insert, update, delete on public.solar_module_series to authenticated;
grant all on public.solar_module_series to service_role;
alter table public.solar_module_series enable row level security;
create policy "series_read" on public.solar_module_series for select to authenticated
  using (company_id is null or public.is_company_member(company_id, auth.uid()));
create policy "series_company_write" on public.solar_module_series for insert to authenticated
  with check (company_id is not null and public.can_write_company_member(company_id, auth.uid()));
create policy "series_company_update" on public.solar_module_series for update to authenticated
  using (company_id is not null and public.can_write_company_member(company_id, auth.uid()))
  with check (company_id is not null and public.can_write_company_member(company_id, auth.uid()));
create policy "series_company_delete" on public.solar_module_series for delete to authenticated
  using (company_id is not null and public.can_manage_company(company_id, auth.uid()));
create policy "series_platform_admin" on public.solar_module_series for all to authenticated
  using (public.is_platform_admin(auth.uid())) with check (public.is_platform_admin(auth.uid()));
create trigger set_updated_at before update on public.solar_module_series
  for each row execute function public.set_updated_at();

/* ------------------------------ Variantes -------------------------------- */
create table public.solar_module_variants (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.solar_module_series(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  model text not null,
  model_original text,
  model_normalized text generated always as (public.solar_normalize_text(model)) stored,
  variant_label text,
  sku text,
  ean text,
  pmax_stc_w integer not null check (pmax_stc_w between 1 and 2000),
  power_tolerance_plus_w numeric(6,2),
  power_tolerance_minus_w numeric(6,2),
  efficiency_pct numeric(5,2),
  voc_v numeric(7,2),
  vmp_v numeric(7,2),
  isc_a numeric(7,2),
  imp_a numeric(7,2),
  max_system_voltage_v integer,
  max_series_fuse_a numeric(6,2),
  temp_coeff_pmax_pct_per_c numeric(6,4),
  temp_coeff_voc_pct_per_c numeric(6,4),
  temp_coeff_isc_pct_per_c numeric(6,4),
  noct_c numeric(5,2),
  temp_min_c numeric(5,1),
  temp_max_c numeric(5,1),
  rear_power_w numeric(7,2),
  ptc_w numeric(7,2),
  status text not null default 'unknown' check (status in ('active','discontinued','archived','unknown')),
  confidence text not null default 'a_verifier'
    check (confidence in ('constructeur','base_officielle','annuaire','entreprise','a_verifier')),
  primary_source text,
  source_ref text,
  warranty_product_years integer,
  warranty_performance_years integer,
  degradation_first_year_pct numeric(5,3),
  degradation_annual_pct numeric(5,3),
  certifications text[] not null default '{}',
  mechanical_load_snow_pa integer,
  mechanical_load_wind_pa integer,
  current_revision_id uuid,
  verified_at timestamptz,
  search_text text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index solar_module_variants_series_idx on public.solar_module_variants(series_id);
create index solar_module_variants_power_idx on public.solar_module_variants(pmax_stc_w);
create index solar_module_variants_company_idx on public.solar_module_variants(company_id);
create index solar_module_variants_search_trgm on public.solar_module_variants using gin (search_text gin_trgm_ops);
create unique index solar_module_variants_global_uidx
  on public.solar_module_variants(series_id, model_normalized, pmax_stc_w) where company_id is null;

create or replace function public.solar_variant_search_text()
returns trigger language plpgsql set search_path = public as $$
declare m text; s text;
begin
  select mf.name, sr.name into m, s
  from public.solar_module_series sr
  join public.solar_manufacturers mf on mf.id = sr.manufacturer_id
  where sr.id = new.series_id;
  new.search_text := lower(public.unaccent_safe(
    coalesce(m,'') || ' ' || coalesce(s,'') || ' ' || coalesce(new.model,'') || ' ' ||
    coalesce(new.model_original,'') || ' ' || new.pmax_stc_w::text || 'w ' ||
    public.solar_normalize_text(coalesce(m,'')) || ' ' || public.solar_normalize_text(coalesce(new.model,''))
  ));
  return new;
end $$;
create trigger solar_variant_search_text_trg before insert or update on public.solar_module_variants
  for each row execute function public.solar_variant_search_text();

grant select, insert, update, delete on public.solar_module_variants to authenticated;
grant all on public.solar_module_variants to service_role;
alter table public.solar_module_variants enable row level security;
create policy "variants_read" on public.solar_module_variants for select to authenticated
  using (company_id is null or public.is_company_member(company_id, auth.uid()));
create policy "variants_company_write" on public.solar_module_variants for insert to authenticated
  with check (company_id is not null and public.can_write_company_member(company_id, auth.uid()));
create policy "variants_company_update" on public.solar_module_variants for update to authenticated
  using (company_id is not null and public.can_write_company_member(company_id, auth.uid()))
  with check (company_id is not null and public.can_write_company_member(company_id, auth.uid()));
create policy "variants_company_delete" on public.solar_module_variants for delete to authenticated
  using (company_id is not null and public.can_manage_company(company_id, auth.uid()));
create policy "variants_platform_admin" on public.solar_module_variants for all to authenticated
  using (public.is_platform_admin(auth.uid())) with check (public.is_platform_admin(auth.uid()));
create trigger set_updated_at before update on public.solar_module_variants
  for each row execute function public.set_updated_at();

/* ------------------------------ Révisions -------------------------------- */
create table public.solar_module_revisions (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.solar_module_variants(id) on delete cascade,
  revision_number integer not null default 1,
  label text,
  height_mm integer,
  width_mm integer,
  depth_mm integer,
  weight_kg numeric(6,2),
  pmax_stc_w integer,
  electrical jsonb not null default '{}'::jsonb,
  datasheet_url text,
  datasheet_checksum text,
  datasheet_language text,
  datasheet_date date,
  datasheet_version text,
  source_type text not null default 'entreprise'
    check (source_type in ('constructeur','base_officielle','annuaire','entreprise','extraction_pdf')),
  is_current boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now()
);
create unique index solar_module_revisions_num_uidx on public.solar_module_revisions(variant_id, revision_number);
create index solar_module_revisions_variant_idx on public.solar_module_revisions(variant_id);
alter table public.solar_module_variants
  add constraint solar_module_variants_current_rev_fk
  foreign key (current_revision_id) references public.solar_module_revisions(id) on delete set null;

grant select, insert, update, delete on public.solar_module_revisions to authenticated;
grant all on public.solar_module_revisions to service_role;
alter table public.solar_module_revisions enable row level security;
create policy "revisions_read" on public.solar_module_revisions for select to authenticated
  using (exists (select 1 from public.solar_module_variants v where v.id = variant_id
    and (v.company_id is null or public.is_company_member(v.company_id, auth.uid()))));
create policy "revisions_company_write" on public.solar_module_revisions for all to authenticated
  using (exists (select 1 from public.solar_module_variants v where v.id = variant_id
    and v.company_id is not null and public.can_write_company_member(v.company_id, auth.uid())))
  with check (exists (select 1 from public.solar_module_variants v where v.id = variant_id
    and v.company_id is not null and public.can_write_company_member(v.company_id, auth.uid())));
create policy "revisions_platform_admin" on public.solar_module_revisions for all to authenticated
  using (public.is_platform_admin(auth.uid())) with check (public.is_platform_admin(auth.uid()));

/* -------------------------- Provenance par champ -------------------------- */
create table public.solar_module_field_sources (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.solar_module_variants(id) on delete cascade,
  field text not null,
  value_text text,
  source_type text not null
    check (source_type in ('constructeur','base_officielle','annuaire','entreprise','extraction_pdf')),
  source_label text,
  source_url text,
  source_page text,
  retrieved_at timestamptz not null default now(),
  confidence text not null default 'a_verifier'
    check (confidence in ('constructeur','base_officielle','annuaire','entreprise','a_verifier')),
  created_at timestamptz not null default now()
);
create unique index solar_module_field_sources_uidx
  on public.solar_module_field_sources(variant_id, field, source_type);

grant select, insert, update, delete on public.solar_module_field_sources to authenticated;
grant all on public.solar_module_field_sources to service_role;
alter table public.solar_module_field_sources enable row level security;
create policy "field_sources_read" on public.solar_module_field_sources for select to authenticated
  using (exists (select 1 from public.solar_module_variants v where v.id = variant_id
    and (v.company_id is null or public.is_company_member(v.company_id, auth.uid()))));
create policy "field_sources_company_write" on public.solar_module_field_sources for all to authenticated
  using (exists (select 1 from public.solar_module_variants v where v.id = variant_id
    and v.company_id is not null and public.can_write_company_member(v.company_id, auth.uid())))
  with check (exists (select 1 from public.solar_module_variants v where v.id = variant_id
    and v.company_id is not null and public.can_write_company_member(v.company_id, auth.uid())));
create policy "field_sources_platform_admin" on public.solar_module_field_sources for all to authenticated
  using (public.is_platform_admin(auth.uid())) with check (public.is_platform_admin(auth.uid()));

/* ------------------------------- Conflits -------------------------------- */
create table public.solar_module_conflicts (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.solar_module_variants(id) on delete cascade,
  field text not null,
  value_a text not null,
  source_a text not null,
  value_b text not null,
  source_b text not null,
  status text not null default 'open' check (status in ('open','resolved','ignored')),
  resolved_value text,
  resolved_source text,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index solar_module_conflicts_variant_idx on public.solar_module_conflicts(variant_id);
create index solar_module_conflicts_status_idx on public.solar_module_conflicts(status);

grant select, insert, update, delete on public.solar_module_conflicts to authenticated;
grant all on public.solar_module_conflicts to service_role;
alter table public.solar_module_conflicts enable row level security;
create policy "conflicts_read" on public.solar_module_conflicts for select to authenticated
  using (exists (select 1 from public.solar_module_variants v where v.id = variant_id
    and (v.company_id is null or public.is_company_member(v.company_id, auth.uid()))));
create policy "conflicts_platform_admin" on public.solar_module_conflicts for all to authenticated
  using (public.is_platform_admin(auth.uid())) with check (public.is_platform_admin(auth.uid()));

/* --------------------------- Travaux catalogue ---------------------------- */
create table public.solar_catalog_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null check (job_type in ('IMPORT_MODULES','UPDATE_MODULES','VERIFY_MODULE','FETCH_DATASHEET')),
  source text not null,
  source_url text,
  source_version text,
  status text not null default 'pending' check (status in ('pending','running','succeeded','failed')),
  params jsonb not null default '{}'::jsonb,
  stats jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);
grant select on public.solar_catalog_jobs to authenticated;
grant all on public.solar_catalog_jobs to service_role;
alter table public.solar_catalog_jobs enable row level security;
create policy "catalog_jobs_admin" on public.solar_catalog_jobs for all to authenticated
  using (public.is_platform_admin(auth.uid())) with check (public.is_platform_admin(auth.uid()));

/* ------------------------------ Journal ---------------------------------- */
create table public.solar_catalog_audit (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  actor_id uuid,
  action text not null,
  variant_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index solar_catalog_audit_variant_idx on public.solar_catalog_audit(variant_id);
grant select, insert on public.solar_catalog_audit to authenticated;
grant all on public.solar_catalog_audit to service_role;
alter table public.solar_catalog_audit enable row level security;
create policy "catalog_audit_read" on public.solar_catalog_audit for select to authenticated
  using (public.is_platform_admin(auth.uid()) or (company_id is not null and public.is_company_member(company_id, auth.uid())));
create policy "catalog_audit_insert" on public.solar_catalog_audit for insert to authenticated
  with check (company_id is null or public.is_company_member(company_id, auth.uid()));

/* --------------------------- Derniers utilisés ---------------------------- */
create table public.solar_module_usage (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  module_variant_id uuid not null references public.solar_module_variants(id) on delete cascade,
  use_count integer not null default 1,
  last_used_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, module_variant_id)
);
create index solar_module_usage_recent_idx on public.solar_module_usage(company_id, last_used_at desc);
grant select, insert, update, delete on public.solar_module_usage to authenticated;
grant all on public.solar_module_usage to service_role;
alter table public.solar_module_usage enable row level security;
create policy "module_usage_read" on public.solar_module_usage for select to authenticated
  using (public.is_company_member(company_id, auth.uid()));
create policy "module_usage_write" on public.solar_module_usage for all to authenticated
  using (public.can_write_company_member(company_id, auth.uid()))
  with check (public.can_write_company_member(company_id, auth.uid()));
create trigger set_updated_at before update on public.solar_module_usage
  for each row execute function public.set_updated_at();

/* ------------------------- Évolutions existantes -------------------------- */
alter table public.solar_module_favorites
  add column module_variant_id uuid references public.solar_module_variants(id) on delete cascade,
  alter column module_catalog_id drop not null;
create unique index solar_module_favorites_variant_uidx
  on public.solar_module_favorites(company_id, module_variant_id) where module_variant_id is not null;

alter table public.solar_arrays
  add column module_variant_id uuid references public.solar_module_variants(id) on delete set null,
  add column module_revision_id uuid references public.solar_module_revisions(id) on delete set null,
  add column module_snapshot jsonb;

alter table public.solar_layout_variants
  add column module_variant_id uuid references public.solar_module_variants(id) on delete set null,
  add column module_snapshot jsonb;

alter table public.company_settings
  add column default_module_variant_id uuid references public.solar_module_variants(id) on delete set null;

/* ------------- Reprise des 6 panneaux de démonstration existants ---------- */
insert into public.solar_manufacturers (name)
select distinct manufacturer from public.solar_module_catalog
on conflict (name_normalized) do nothing;

insert into public.solar_module_series
  (manufacturer_id, name, height_mm, width_mm, depth_mm, technologies, cell_count)
select mf.id, c.reference, c.height_mm, c.width_mm, c.thickness_mm,
       case when c.technology is null then '{}'::text[] else array[c.technology] end,
       c.cell_count
from public.solar_module_catalog c
join public.solar_manufacturers mf on mf.name_normalized = public.solar_normalize_text(c.manufacturer)
on conflict do nothing;

insert into public.solar_module_variants
  (id, series_id, model, model_original, pmax_stc_w, efficiency_pct, voc_v, vmp_v, isc_a, imp_a,
   temp_coeff_pmax_pct_per_c, status, confidence, primary_source)
select c.id, sr.id, c.reference, c.reference, c.power_wc, c.efficiency_pct,
       c.voc_v, c.vmp_v, c.isc_a, c.imp_a, c.temp_coeff_pmax_pct_per_c,
       case when c.is_active then 'active' else 'archived' end,
       'a_verifier', coalesce(c.datasheet_source, 'demonstration')
from public.solar_module_catalog c
join public.solar_manufacturers mf on mf.name_normalized = public.solar_normalize_text(c.manufacturer)
join public.solar_module_series sr on sr.manufacturer_id = mf.id
  and sr.name_normalized = public.solar_normalize_text(c.reference) and sr.company_id is null
on conflict (id) do nothing;

with rev as (
  insert into public.solar_module_revisions
    (variant_id, revision_number, label, height_mm, width_mm, depth_mm, pmax_stc_w, datasheet_url, source_type)
  select v.id, 1, 'Reprise catalogue initial', c.height_mm, c.width_mm, c.thickness_mm, c.power_wc,
         c.datasheet_url, 'entreprise'
  from public.solar_module_variants v
  join public.solar_module_catalog c on c.id = v.id
  returning id, variant_id
)
update public.solar_module_variants v set current_revision_id = rev.id
from rev where rev.variant_id = v.id;

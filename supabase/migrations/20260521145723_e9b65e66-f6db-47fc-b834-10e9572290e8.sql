
-- ============ ENUMS ============
do $$ begin
  create type public.company_role as enum ('owner','admin','manager','user');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.member_status as enum ('active','invited','suspended');
exception when duplicate_object then null; end $$;

-- ============ COMPANIES ============
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  siret text,
  address text,
  phone text,
  email text,
  logo_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.companies enable row level security;

create table if not exists public.company_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null,
  role public.company_role not null default 'user',
  status public.member_status not null default 'active',
  invited_email text,
  created_at timestamptz not null default now(),
  unique (company_id, user_id)
);
alter table public.company_members enable row level security;
create index if not exists idx_company_members_user on public.company_members(user_id);
create index if not exists idx_company_members_company on public.company_members(company_id);

-- ============ SECURITY DEFINER HELPERS ============
create or replace function public.is_company_member(_company_id uuid, _user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.company_members
    where company_id = _company_id and user_id = _user_id and status = 'active');
$$;

create or replace function public.get_company_role(_company_id uuid, _user_id uuid)
returns public.company_role language sql stable security definer set search_path = public as $$
  select role from public.company_members
    where company_id = _company_id and user_id = _user_id and status = 'active' limit 1;
$$;

create or replace function public.can_manage_company(_company_id uuid, _user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.company_members
    where company_id = _company_id and user_id = _user_id and status = 'active'
      and role in ('owner','admin','manager'));
$$;

create or replace function public.is_company_admin(_company_id uuid, _user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.company_members
    where company_id = _company_id and user_id = _user_id and status = 'active'
      and role in ('owner','admin'));
$$;

create or replace function public.is_company_owner(_company_id uuid, _user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.company_members
    where company_id = _company_id and user_id = _user_id and status = 'active'
      and role = 'owner');
$$;

-- ============ ADD company_id TO EXISTING TABLES ============
alter table public.clients     add column if not exists company_id uuid references public.companies(id) on delete cascade;
alter table public.chantiers   add column if not exists company_id uuid references public.companies(id) on delete cascade;
alter table public.pv          add column if not exists company_id uuid references public.companies(id) on delete cascade;
alter table public.pv_photos   add column if not exists company_id uuid references public.companies(id) on delete cascade;
alter table public.pv_reserves add column if not exists company_id uuid references public.companies(id) on delete cascade;

-- ============ NOTIFICATIONS ============
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid,
  title text not null,
  body text,
  type text not null default 'info',
  read boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.notifications enable row level security;
create index if not exists idx_notif_company on public.notifications(company_id);

-- ============ BACKFILL : créer une entreprise par owner_id distinct ============
do $$
declare r record; new_company uuid; user_full_name text;
begin
  for r in (
    select distinct owner_id from (
      select owner_id from public.clients
      union select owner_id from public.chantiers
      union select owner_id from public.pv
      union select owner_id from public.pv_photos
      union select owner_id from public.pv_reserves
    ) s where owner_id is not null
  ) loop
    -- skip si déjà membre quelque part
    if exists(select 1 from public.company_members where user_id = r.owner_id) then
      select company_id into new_company from public.company_members where user_id = r.owner_id limit 1;
    else
      select coalesce(company_name, full_name, 'Mon entreprise') into user_full_name
        from public.profiles where id = r.owner_id;
      insert into public.companies(name) values (coalesce(user_full_name, 'Mon entreprise'))
        returning id into new_company;
      insert into public.company_members(company_id, user_id, role, status)
        values (new_company, r.owner_id, 'owner', 'active');
    end if;

    update public.clients     set company_id = new_company where owner_id = r.owner_id and company_id is null;
    update public.chantiers   set company_id = new_company where owner_id = r.owner_id and company_id is null;
    update public.pv          set company_id = new_company where owner_id = r.owner_id and company_id is null;
    update public.pv_photos   set company_id = new_company where owner_id = r.owner_id and company_id is null;
    update public.pv_reserves set company_id = new_company where owner_id = r.owner_id and company_id is null;
  end loop;
end $$;

-- ============ AUTO-CREATE COMPANY ON SIGNUP ============
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare new_company uuid; cname text;
begin
  insert into public.profiles (id, full_name, company_name)
  values (new.id, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'company_name')
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role) values (new.id, 'admin')
  on conflict do nothing;

  cname := coalesce(nullif(new.raw_user_meta_data->>'company_name',''), nullif(new.raw_user_meta_data->>'full_name',''), 'Mon entreprise');
  insert into public.companies(name, email) values (cname, new.email) returning id into new_company;
  insert into public.company_members(company_id, user_id, role, status)
    values (new_company, new.id, 'owner', 'active');
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============ RLS POLICIES ============

-- companies
drop policy if exists companies_select on public.companies;
create policy companies_select on public.companies for select
  using (public.is_company_member(id, auth.uid()));
drop policy if exists companies_insert on public.companies;
create policy companies_insert on public.companies for insert
  with check (auth.uid() is not null);
drop policy if exists companies_update on public.companies;
create policy companies_update on public.companies for update
  using (public.is_company_admin(id, auth.uid()));
drop policy if exists companies_delete on public.companies;
create policy companies_delete on public.companies for delete
  using (public.is_company_owner(id, auth.uid()));

-- company_members
drop policy if exists members_select on public.company_members;
create policy members_select on public.company_members for select
  using (public.is_company_member(company_id, auth.uid()) or user_id = auth.uid());
drop policy if exists members_insert on public.company_members;
create policy members_insert on public.company_members for insert
  with check (public.is_company_admin(company_id, auth.uid()) or
              (user_id = auth.uid() and not exists(select 1 from public.company_members m where m.company_id = company_members.company_id)));
drop policy if exists members_update on public.company_members;
create policy members_update on public.company_members for update
  using (public.is_company_admin(company_id, auth.uid()));
drop policy if exists members_delete on public.company_members;
create policy members_delete on public.company_members for delete
  using (public.is_company_admin(company_id, auth.uid()));

-- generic helper to rebuild policies on metier tables
-- clients
drop policy if exists clients_all_own on public.clients;
drop policy if exists clients_select on public.clients;
drop policy if exists clients_write on public.clients;
create policy clients_select on public.clients for select
  using (public.is_company_member(company_id, auth.uid()));
create policy clients_write on public.clients for all
  using (public.can_manage_company(company_id, auth.uid()))
  with check (public.can_manage_company(company_id, auth.uid()));

-- chantiers
drop policy if exists chantiers_all_own on public.chantiers;
drop policy if exists chantiers_select on public.chantiers;
drop policy if exists chantiers_write on public.chantiers;
create policy chantiers_select on public.chantiers for select
  using (public.is_company_member(company_id, auth.uid()));
create policy chantiers_write on public.chantiers for all
  using (public.can_manage_company(company_id, auth.uid()))
  with check (public.can_manage_company(company_id, auth.uid()));

-- pv : tous les membres peuvent voir et créer ; modif/suppression managers+
drop policy if exists pv_all_own on public.pv;
drop policy if exists pv_select on public.pv;
drop policy if exists pv_insert on public.pv;
drop policy if exists pv_update on public.pv;
drop policy if exists pv_delete on public.pv;
create policy pv_select on public.pv for select
  using (public.is_company_member(company_id, auth.uid()));
create policy pv_insert on public.pv for insert
  with check (public.is_company_member(company_id, auth.uid()));
create policy pv_update on public.pv for update
  using (public.can_manage_company(company_id, auth.uid()) or owner_id = auth.uid());
create policy pv_delete on public.pv for delete
  using (public.can_manage_company(company_id, auth.uid()));

-- pv_photos
drop policy if exists pv_photos_all_own on public.pv_photos;
drop policy if exists pv_photos_select on public.pv_photos;
drop policy if exists pv_photos_write on public.pv_photos;
create policy pv_photos_select on public.pv_photos for select
  using (public.is_company_member(company_id, auth.uid()));
create policy pv_photos_write on public.pv_photos for all
  using (public.is_company_member(company_id, auth.uid()))
  with check (public.is_company_member(company_id, auth.uid()));

-- pv_reserves
drop policy if exists pv_reserves_all_own on public.pv_reserves;
drop policy if exists pv_reserves_select on public.pv_reserves;
drop policy if exists pv_reserves_write on public.pv_reserves;
create policy pv_reserves_select on public.pv_reserves for select
  using (public.is_company_member(company_id, auth.uid()));
create policy pv_reserves_write on public.pv_reserves for all
  using (public.is_company_member(company_id, auth.uid()))
  with check (public.is_company_member(company_id, auth.uid()));

-- notifications
drop policy if exists notif_select on public.notifications;
create policy notif_select on public.notifications for select
  using (public.is_company_member(company_id, auth.uid()));
drop policy if exists notif_insert on public.notifications;
create policy notif_insert on public.notifications for insert
  with check (public.is_company_member(company_id, auth.uid()));
drop policy if exists notif_update on public.notifications;
create policy notif_update on public.notifications for update
  using (public.is_company_member(company_id, auth.uid()));

-- triggers updated_at
drop trigger if exists trg_companies_updated on public.companies;
create trigger trg_companies_updated before update on public.companies
  for each row execute function public.set_updated_at();

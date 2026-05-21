
-- Enum for roles
create type public.app_role as enum ('admin','manager','user');

-- profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  company_name text,
  phone text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);

-- user_roles
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role app_role not null,
  created_at timestamptz not null default now(),
  unique(user_id, role)
);
alter table public.user_roles enable row level security;
create policy "roles_select_own" on public.user_roles for select using (auth.uid() = user_id);

create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

-- clients
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  email text,
  phone text,
  address text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.clients enable row level security;
create policy "clients_all_own" on public.clients for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- chantiers
create table public.chantiers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  name text not null,
  address text,
  type text,
  status text not null default 'en_cours',
  start_date date,
  end_date date,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.chantiers enable row level security;
create policy "chantiers_all_own" on public.chantiers for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- pv (procès-verbaux)
create table public.pv (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  chantier_id uuid references public.chantiers(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  numero text not null,
  type text not null default 'reception',
  status text not null default 'brouillon',
  reception_date date,
  description text,
  observations text,
  client_signature text,
  company_signature text,
  signed_at timestamptz,
  pdf_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.pv enable row level security;
create policy "pv_all_own" on public.pv for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- pv_photos
create table public.pv_photos (
  id uuid primary key default gen_random_uuid(),
  pv_id uuid not null references public.pv(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  url text not null,
  caption text,
  created_at timestamptz not null default now()
);
alter table public.pv_photos enable row level security;
create policy "pv_photos_all_own" on public.pv_photos for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- pv_reserves
create table public.pv_reserves (
  id uuid primary key default gen_random_uuid(),
  pv_id uuid not null references public.pv(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  description text not null,
  severity text not null default 'mineure',
  status text not null default 'ouverte',
  created_at timestamptz not null default now()
);
alter table public.pv_reserves enable row level security;
create policy "pv_reserves_all_own" on public.pv_reserves for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- updated_at trigger
create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create trigger trg_profiles_updated before update on public.profiles for each row execute function public.set_updated_at();
create trigger trg_clients_updated before update on public.clients for each row execute function public.set_updated_at();
create trigger trg_chantiers_updated before update on public.chantiers for each row execute function public.set_updated_at();
create trigger trg_pv_updated before update on public.pv for each row execute function public.set_updated_at();

-- handle_new_user
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, company_name)
  values (new.id, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'company_name');
  insert into public.user_roles (user_id, role) values (new.id, 'admin');
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Storage bucket
insert into storage.buckets (id, name, public) values ('pv-assets','pv-assets', false);

create policy "pv_assets_select_own" on storage.objects for select using (
  bucket_id = 'pv-assets' and auth.uid()::text = (storage.foldername(name))[1]
);
create policy "pv_assets_insert_own" on storage.objects for insert with check (
  bucket_id = 'pv-assets' and auth.uid()::text = (storage.foldername(name))[1]
);
create policy "pv_assets_update_own" on storage.objects for update using (
  bucket_id = 'pv-assets' and auth.uid()::text = (storage.foldername(name))[1]
);
create policy "pv_assets_delete_own" on storage.objects for delete using (
  bucket_id = 'pv-assets' and auth.uid()::text = (storage.foldername(name))[1]
);

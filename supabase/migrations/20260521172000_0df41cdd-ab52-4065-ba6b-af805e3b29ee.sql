-- ============================================================
-- TABLE: plan_limits (référentiel quotas par plan)
-- ============================================================
create table public.plan_limits (
  plan text primary key,
  max_pv_per_month integer,
  max_members integer,
  can_remote_sign boolean not null default false,
  can_advanced_stats boolean not null default false,
  can_export_audit boolean not null default false,
  can_branding boolean not null default false,
  display_name text not null,
  monthly_price_eur integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.plan_limits enable row level security;

create policy "plan_limits_select_all"
  on public.plan_limits for select
  to authenticated
  using (true);

create trigger trg_plan_limits_updated
  before update on public.plan_limits
  for each row execute function public.set_updated_at();

insert into public.plan_limits
  (plan, max_pv_per_month, max_members, can_remote_sign, can_advanced_stats, can_export_audit, can_branding, display_name, monthly_price_eur)
values
  ('starter',    10,   1,    false, false, false, false, 'Starter',    19),
  ('pro',        100,  5,    true,  true,  true,  false, 'Pro',        49),
  ('enterprise', null, null, true,  true,  true,  true,  'Entreprise', 199);

-- ============================================================
-- TABLE: subscriptions (abonnement Stripe par entreprise)
-- ============================================================
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  user_id uuid not null,
  stripe_customer_id text not null,
  stripe_subscription_id text not null unique,
  plan text not null references public.plan_limits(plan),
  status text not null default 'active',
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  trial_end timestamptz,
  environment text not null default 'sandbox',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_subscriptions_company on public.subscriptions(company_id);
create index idx_subscriptions_customer on public.subscriptions(stripe_customer_id);

alter table public.subscriptions enable row level security;

create policy "subscriptions_select_member"
  on public.subscriptions for select
  using (is_company_member(company_id, auth.uid()));

-- No INSERT/UPDATE/DELETE policies → only service role (webhook) can write.

create trigger trg_subscriptions_updated
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- ============================================================
-- HELPER FUNCTIONS (SECURITY DEFINER, scoped search_path)
-- ============================================================

-- Plan actif d'une entreprise (Starter par défaut)
create or replace function public.get_company_plan(_company_id uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (
      select plan from public.subscriptions
      where company_id = _company_id
        and environment = coalesce(current_setting('app.stripe_env', true), 'sandbox')
        and (
          (status in ('active','trialing','past_due') and (current_period_end is null or current_period_end > now()))
          or (status = 'canceled' and current_period_end > now())
        )
      order by created_at desc
      limit 1
    ),
    'starter'
  );
$$;

-- Limites du plan actif d'une entreprise
create or replace function public.get_company_limits(_company_id uuid)
returns plan_limits
language sql stable security definer set search_path = public
as $$
  select pl.* from public.plan_limits pl
  where pl.plan = public.get_company_plan(_company_id);
$$;

-- Nombre de PV créés dans la période de facturation courante
create or replace function public.get_company_pv_count_current_period(_company_id uuid)
returns integer
language plpgsql stable security definer set search_path = public
as $$
declare
  _start timestamptz;
  _count integer;
begin
  select current_period_start into _start
  from public.subscriptions
  where company_id = _company_id
    and status in ('active','trialing','past_due')
  order by created_at desc
  limit 1;

  if _start is null then
    _start := date_trunc('month', now());
  end if;

  select count(*) into _count from public.pv
  where company_id = _company_id
    and created_at >= _start;

  return coalesce(_count, 0);
end $$;

-- Nombre de membres actifs (hors invités)
create or replace function public.get_company_member_count(_company_id uuid)
returns integer
language sql stable security definer set search_path = public
as $$
  select count(*)::int from public.company_members
  where company_id = _company_id and status = 'active';
$$;

-- Peut-on créer un nouveau PV ? (quota mensuel)
create or replace function public.can_create_pv(_company_id uuid)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare _max int; _used int;
begin
  select max_pv_per_month into _max
  from public.plan_limits where plan = public.get_company_plan(_company_id);

  if _max is null then return true; end if;
  _used := public.get_company_pv_count_current_period(_company_id);
  return _used < _max;
end $$;

-- Peut-on ajouter un membre ?
create or replace function public.can_add_member(_company_id uuid)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare _max int; _used int;
begin
  select max_members into _max
  from public.plan_limits where plan = public.get_company_plan(_company_id);

  if _max is null then return true; end if;
  _used := public.get_company_member_count(_company_id);
  return _used < _max;
end $$;

-- Accès à une fonctionnalité plan
create or replace function public.has_plan_feature(_company_id uuid, _feature text)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare _lim plan_limits;
begin
  select * into _lim from public.plan_limits where plan = public.get_company_plan(_company_id);
  if _lim is null then return false; end if;
  return case _feature
    when 'remote_sign'    then _lim.can_remote_sign
    when 'advanced_stats' then _lim.can_advanced_stats
    when 'export_audit'   then _lim.can_export_audit
    when 'branding'       then _lim.can_branding
    else false
  end;
end $$;

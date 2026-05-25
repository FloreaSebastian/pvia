
-- API keys
create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  created_by uuid,
  name text not null,
  prefix text not null,
  key_hash text not null,
  scopes text[] not null default array['read']::text[],
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_api_keys_company on public.api_keys(company_id);
create index idx_api_keys_prefix on public.api_keys(prefix);
alter table public.api_keys enable row level security;

create policy "api_keys_select" on public.api_keys for select
  using (is_company_member(company_id, auth.uid()));
create policy "api_keys_insert" on public.api_keys for insert
  with check (is_company_admin(company_id, auth.uid()));
create policy "api_keys_update" on public.api_keys for update
  using (is_company_admin(company_id, auth.uid()))
  with check (is_company_admin(company_id, auth.uid()));
create policy "api_keys_delete" on public.api_keys for delete
  using (is_company_admin(company_id, auth.uid()));

-- Webhooks
create table public.webhooks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  created_by uuid,
  url text not null,
  secret text not null,
  events text[] not null default array[]::text[],
  enabled boolean not null default true,
  description text,
  last_delivery_at timestamptz,
  last_status int,
  failure_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_webhooks_company on public.webhooks(company_id);
alter table public.webhooks enable row level security;

create policy "webhooks_select" on public.webhooks for select
  using (is_company_member(company_id, auth.uid()));
create policy "webhooks_insert" on public.webhooks for insert
  with check (is_company_admin(company_id, auth.uid()));
create policy "webhooks_update" on public.webhooks for update
  using (is_company_admin(company_id, auth.uid()))
  with check (is_company_admin(company_id, auth.uid()));
create policy "webhooks_delete" on public.webhooks for delete
  using (is_company_admin(company_id, auth.uid()));

create trigger set_webhooks_updated_at before update on public.webhooks
  for each row execute function public.set_updated_at();

-- Webhook deliveries (queue + journal)
create table public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  webhook_id uuid not null references public.webhooks(id) on delete cascade,
  company_id uuid not null,
  event text not null,
  payload jsonb not null,
  status text not null default 'pending',
  attempts int not null default 0,
  response_code int,
  response_body text,
  error text,
  next_attempt_at timestamptz not null default now(),
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_deliveries_webhook on public.webhook_deliveries(webhook_id);
create index idx_deliveries_company on public.webhook_deliveries(company_id);
create index idx_deliveries_pending on public.webhook_deliveries(status, next_attempt_at)
  where status = 'pending';
alter table public.webhook_deliveries enable row level security;

create policy "deliveries_select" on public.webhook_deliveries for select
  using (is_company_member(company_id, auth.uid()));

-- Enqueue helper
create or replace function public.enqueue_webhook_event(
  _company_id uuid, _event text, _payload jsonb
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.webhook_deliveries (webhook_id, company_id, event, payload)
  select w.id, w.company_id, _event, _payload
  from public.webhooks w
  where w.company_id = _company_id
    and w.enabled = true
    and _event = any(w.events);
end $$;

-- Trigger on PV events: create / sign / sent_to_client
create or replace function public.webhook_on_pv_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare _evt text; _payload jsonb;
begin
  if TG_OP = 'INSERT' then
    _evt := 'pv.created';
  elsif TG_OP = 'UPDATE' and new.status = 'signe' and coalesce(old.status,'') <> 'signe' then
    _evt := 'pv.signed';
  elsif TG_OP = 'UPDATE' and new.sent_to_client_at is not null
        and (old.sent_to_client_at is null or old.sent_to_client_at <> new.sent_to_client_at) then
    _evt := 'pv.sent_to_client';
  else
    return new;
  end if;

  _payload := jsonb_build_object(
    'event', _evt,
    'occurred_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'pv', jsonb_build_object(
      'id', new.id,
      'numero', new.numero,
      'status', new.status,
      'type', new.type,
      'company_id', new.company_id,
      'client_id', new.client_id,
      'chantier_id', new.chantier_id,
      'signed_at', new.signed_at,
      'sent_to_client_at', new.sent_to_client_at,
      'sent_to_email', new.sent_to_email
    )
  );
  perform public.enqueue_webhook_event(new.company_id, _evt, _payload);
  return new;
end $$;

drop trigger if exists trg_webhook_pv_insert on public.pv;
create trigger trg_webhook_pv_insert after insert on public.pv
  for each row execute function public.webhook_on_pv_event();

drop trigger if exists trg_webhook_pv_update on public.pv;
create trigger trg_webhook_pv_update after update on public.pv
  for each row execute function public.webhook_on_pv_event();

-- Trigger on reserves
create or replace function public.webhook_on_reserve_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare _evt text; _payload jsonb;
begin
  if TG_OP = 'INSERT' then
    _evt := 'reserve.created';
  elsif TG_OP = 'UPDATE' and new.status = 'levee' and coalesce(old.status,'') <> 'levee' then
    _evt := 'reserve.lifted';
  else
    return new;
  end if;
  _payload := jsonb_build_object(
    'event', _evt,
    'occurred_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'reserve', jsonb_build_object(
      'id', new.id,
      'pv_id', new.pv_id,
      'company_id', new.company_id,
      'description', new.description,
      'severity', new.severity,
      'status', new.status
    )
  );
  perform public.enqueue_webhook_event(new.company_id, _evt, _payload);
  return new;
end $$;

drop trigger if exists trg_webhook_reserve_insert on public.pv_reserves;
create trigger trg_webhook_reserve_insert after insert on public.pv_reserves
  for each row execute function public.webhook_on_reserve_event();

drop trigger if exists trg_webhook_reserve_update on public.pv_reserves;
create trigger trg_webhook_reserve_update after update on public.pv_reserves
  for each row execute function public.webhook_on_reserve_event();

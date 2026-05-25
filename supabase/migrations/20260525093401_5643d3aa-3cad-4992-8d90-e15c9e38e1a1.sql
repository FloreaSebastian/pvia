
alter table public.webhooks
  add column if not exists delivery_format text not null default 'raw'
    check (delivery_format in ('raw','slack','discord'));

create table public.integration_calendar_tokens (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  created_by uuid,
  token text not null unique,
  name text not null default 'Flux calendrier',
  scope text not null default 'all' check (scope in ('all','signed_only','field_visits')),
  revoked_at timestamptz,
  last_accessed_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_cal_tokens_company on public.integration_calendar_tokens(company_id);
create index idx_cal_tokens_token on public.integration_calendar_tokens(token);

alter table public.integration_calendar_tokens enable row level security;

create policy "cal_tokens_select" on public.integration_calendar_tokens for select
  using (is_company_member(company_id, auth.uid()));
create policy "cal_tokens_insert" on public.integration_calendar_tokens for insert
  with check (is_company_admin(company_id, auth.uid()));
create policy "cal_tokens_update" on public.integration_calendar_tokens for update
  using (is_company_admin(company_id, auth.uid()))
  with check (is_company_admin(company_id, auth.uid()));
create policy "cal_tokens_delete" on public.integration_calendar_tokens for delete
  using (is_company_admin(company_id, auth.uid()));

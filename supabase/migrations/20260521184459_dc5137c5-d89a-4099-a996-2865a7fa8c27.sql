
create table if not exists public.app_errors (
  id uuid primary key default gen_random_uuid(),
  severity text not null default 'error' check (severity in ('info','warning','error','critical')),
  source text not null,
  message text not null,
  stack text,
  context jsonb,
  user_id uuid,
  company_id uuid,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists app_errors_created_at_idx on public.app_errors(created_at desc);
create index if not exists app_errors_severity_idx on public.app_errors(severity, resolved);
create index if not exists app_errors_source_idx on public.app_errors(source);

alter table public.app_errors enable row level security;

-- Only platform admins (user_roles.role = 'admin') can see errors
create policy "app_errors_select_admin"
  on public.app_errors for select
  using (public.has_role(auth.uid(), 'admin'));

create policy "app_errors_update_admin"
  on public.app_errors for update
  using (public.has_role(auth.uid(), 'admin'));

-- No insert policy → only service role can insert

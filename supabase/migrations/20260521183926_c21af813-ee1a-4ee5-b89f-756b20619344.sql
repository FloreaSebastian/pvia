
create table if not exists public.rate_limits (
  id uuid primary key default gen_random_uuid(),
  bucket text not null,
  key text not null,
  count integer not null default 1,
  window_start timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists rate_limits_bucket_key_window
  on public.rate_limits(bucket, key, window_start);

create index if not exists rate_limits_window_start_idx
  on public.rate_limits(window_start);

alter table public.rate_limits enable row level security;

-- No policies = no client access (only service role bypasses RLS)

-- Cleanup function callable from cron
create or replace function public.cleanup_rate_limits()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare _n int;
begin
  delete from public.rate_limits where window_start < now() - interval '24 hours';
  get diagnostics _n = row_count;
  return _n;
end $$;

-- Schedule daily cleanup
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('cleanup-rate-limits') where exists (
      select 1 from cron.job where jobname = 'cleanup-rate-limits'
    );
    perform cron.schedule(
      'cleanup-rate-limits',
      '17 3 * * *',
      $cron$ select public.cleanup_rate_limits(); $cron$
    );
  end if;
end $$;


create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  company_id uuid not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);
create index if not exists push_subscriptions_company_idx on public.push_subscriptions(company_id);

alter table public.push_subscriptions enable row level security;

create policy "push_sub_select_own" on public.push_subscriptions
  for select using (user_id = auth.uid());

create policy "push_sub_delete_own" on public.push_subscriptions
  for delete using (user_id = auth.uid());

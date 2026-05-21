-- Create email_logs table for tracking outbound emails
create table if not exists public.email_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  pv_id uuid,
  recipient_email text not null,
  email_type text not null,
  status text not null default 'sent',
  resend_id text,
  error_message text,
  subject text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists email_logs_pv_id_idx on public.email_logs(pv_id);
create index if not exists email_logs_company_id_idx on public.email_logs(company_id);

alter table public.email_logs enable row level security;

create policy "email_logs_select" on public.email_logs
  for select using (company_id is not null and public.is_company_member(company_id, auth.uid()));

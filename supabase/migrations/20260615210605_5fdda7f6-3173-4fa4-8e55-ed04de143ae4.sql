-- ============================================================
-- WF-C2: Atomic OTP consumption (no TOCTOU)
-- ============================================================
create or replace function public.consume_signature_otp(
  p_otp_id uuid,
  p_code_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_now timestamptz := now();
begin
  select * into v_row
    from public.pv_signature_otps
    where id = p_otp_id
    for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_row.used_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_used');
  end if;
  if v_row.expires_at < v_now then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if coalesce(v_row.attempts, 0) >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'too_many_attempts');
  end if;
  if v_row.code_hash <> p_code_hash then
    update public.pv_signature_otps
      set attempts = coalesce(attempts, 0) + 1
      where id = p_otp_id;
    return jsonb_build_object('ok', false, 'reason', 'bad_code',
                              'attempts', coalesce(v_row.attempts, 0) + 1);
  end if;
  update public.pv_signature_otps
    set used_at = v_now
    where id = p_otp_id;
  return jsonb_build_object(
    'ok', true,
    'company_id', v_row.company_id,
    'pv_id', v_row.pv_id,
    'signature_mode', v_row.signature_mode,
    'email', v_row.email,
    'used_at', v_now
  );
end$$;

revoke all on function public.consume_signature_otp(uuid, text) from public;
grant execute on function public.consume_signature_otp(uuid, text) to service_role;

-- ============================================================
-- WF-C3: Atomic reserve-lift numbering
-- ============================================================
create or replace function public.generate_next_reserve_lift_number(
  p_pv_id uuid
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base text;
  v_next int;
begin
  -- Lock the PV row to serialize concurrent number generation for this PV.
  select numero into v_base
    from public.pv
    where id = p_pv_id
    for update;
  if v_base is null then v_base := 'PV'; end if;

  -- Largest existing suffix + 1 (safe even with custom existing numbers).
  select coalesce(
    max(
      (regexp_match(numero, '-LR-(\d+)$'))[1]::int
    ),
    0
  ) + 1
    into v_next
    from public.reserve_lift_reports
    where pv_id = p_pv_id;

  return v_base || '-LR-' || lpad(v_next::text, 2, '0');
end$$;

revoke all on function public.generate_next_reserve_lift_number(uuid) from public;
grant execute on function public.generate_next_reserve_lift_number(uuid) to service_role;

-- Unique constraint to make collisions explicit and recoverable.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'reserve_lift_reports_pv_numero_uk'
  ) then
    alter table public.reserve_lift_reports
      add constraint reserve_lift_reports_pv_numero_uk unique (pv_id, numero);
  end if;
end$$;

-- ============================================================
-- ST-C2 / ST-C3: Webhook idempotency table
-- ============================================================
create table if not exists public.stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  environment text not null,
  payload jsonb,
  processed_at timestamptz not null default now()
);

grant select, insert on public.stripe_webhook_events to service_role;
alter table public.stripe_webhook_events enable row level security;

drop policy if exists "stripe_events_admin_select" on public.stripe_webhook_events;
create policy "stripe_events_admin_select"
  on public.stripe_webhook_events
  for select
  to authenticated
  using (public.is_platform_admin(auth.uid()));

create index if not exists idx_stripe_webhook_events_processed_at
  on public.stripe_webhook_events (processed_at desc);

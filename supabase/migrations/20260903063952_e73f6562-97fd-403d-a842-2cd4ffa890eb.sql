CREATE TABLE IF NOT EXISTS public.pv_quota_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  pv_id uuid UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.pv_quota_ledger TO authenticated;
GRANT ALL ON public.pv_quota_ledger TO service_role;

ALTER TABLE public.pv_quota_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members read own company pv quota ledger" ON public.pv_quota_ledger;
CREATE POLICY "members read own company pv quota ledger"
  ON public.pv_quota_ledger FOR SELECT TO authenticated
  USING (public.is_company_member(company_id, auth.uid()));

CREATE INDEX IF NOT EXISTS pv_quota_ledger_company_created_idx
  ON public.pv_quota_ledger (company_id, created_at DESC);

INSERT INTO public.pv_quota_ledger (company_id, pv_id, created_at)
SELECT p.company_id, p.id, p.created_at
  FROM public.pv p
 WHERE p.company_id IS NOT NULL
ON CONFLICT (pv_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.business_month_start()
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT (date_trunc('month', (now() AT TIME ZONE 'Europe/Paris')) AT TIME ZONE 'Europe/Paris');
$$;

CREATE OR REPLACE FUNCTION public.get_company_pv_count_current_period(_company_id uuid)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT coalesce(count(*), 0)::int
    FROM public.pv_quota_ledger l
   WHERE l.company_id = _company_id
     AND l.created_at >= public.business_month_start();
$$;

CREATE OR REPLACE FUNCTION public.pv_record_quota_usage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
begin
  if NEW.company_id is not null then
    insert into public.pv_quota_ledger (company_id, pv_id, created_at)
    values (NEW.company_id, NEW.id, coalesce(NEW.created_at, now()))
    on conflict (pv_id) do nothing;
  end if;
  return NEW;
end $$;

DROP TRIGGER IF EXISTS pv_record_quota_usage_trg ON public.pv;
CREATE TRIGGER pv_record_quota_usage_trg
AFTER INSERT ON public.pv
FOR EACH ROW EXECUTE FUNCTION public.pv_record_quota_usage();

CREATE OR REPLACE FUNCTION public.pv_enforce_month_quota()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare _max int; _used int;
begin
  if NEW.company_id is null then
    return NEW;
  end if;

  select max_pv_per_month into _max
    from public.plan_limits
   where plan = public.get_company_plan(NEW.company_id);

  if _max is null then
    return NEW;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('pvia_pv_quota:' || NEW.company_id::text, 0));

  select count(*)::int into _used
    from public.pv_quota_ledger l
   where l.company_id = NEW.company_id
     and l.created_at >= public.business_month_start();

  if _used >= _max then
    raise exception 'PV_QUOTA_EXCEEDED: % / % PV ce mois-ci', _used, _max
      using errcode = 'check_violation';
  end if;

  return NEW;
end $$;

DROP TRIGGER IF EXISTS pv_enforce_month_quota_trg ON public.pv;
CREATE TRIGGER pv_enforce_month_quota_trg
BEFORE INSERT ON public.pv
FOR EACH ROW EXECUTE FUNCTION public.pv_enforce_month_quota();
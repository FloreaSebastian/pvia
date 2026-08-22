-- 1. Extend plan_limits into the single source of truth for the pricing grid
ALTER TABLE public.plan_limits
  ADD COLUMN IF NOT EXISTS annual_price_eur integer,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS is_custom_pricing boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recommended boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_price_monthly text,
  ADD COLUMN IF NOT EXISTS stripe_price_annual text,
  ADD COLUMN IF NOT EXISTS tagline text;

-- 2. Essentiel (internal key kept as 'starter' — referenced by existing subscriptions/code)
UPDATE public.plan_limits SET
  display_name = 'Essentiel',
  monthly_price_eur = 19,
  annual_price_eur = 190,
  max_members = 1,
  sort_order = 1,
  recommended = false,
  is_custom_pricing = false,
  stripe_price_monthly = 'starter_monthly',
  stripe_price_annual = 'starter_annual',
  tagline = 'Pour les indépendants et artisans.',
  updated_at = now()
WHERE plan = 'starter';

-- 3. Pro
UPDATE public.plan_limits SET
  display_name = 'Pro',
  monthly_price_eur = 59,
  annual_price_eur = 590,
  max_members = 5,
  sort_order = 2,
  recommended = true,
  is_custom_pricing = false,
  stripe_price_monthly = 'pro_monthly',
  stripe_price_annual = 'pro_annual',
  tagline = 'Pour les petites équipes et entreprises du bâtiment.',
  updated_at = now()
WHERE plan = 'pro';

-- 4. Business (new)
INSERT INTO public.plan_limits (
  plan, display_name, monthly_price_eur, annual_price_eur, max_members, max_pv_per_month,
  can_remote_sign, can_advanced_stats, can_export_audit, can_branding,
  sort_order, recommended, is_custom_pricing, stripe_price_monthly, stripe_price_annual, tagline
) VALUES (
  'business', 'Business', 149, 1490, 20, NULL,
  true, true, true, true,
  3, false, false, 'business_monthly', 'business_annual',
  'Pour les entreprises avec plusieurs équipes et conducteurs de travaux.'
)
ON CONFLICT (plan) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  monthly_price_eur = EXCLUDED.monthly_price_eur,
  annual_price_eur = EXCLUDED.annual_price_eur,
  max_members = EXCLUDED.max_members,
  max_pv_per_month = EXCLUDED.max_pv_per_month,
  can_remote_sign = EXCLUDED.can_remote_sign,
  can_advanced_stats = EXCLUDED.can_advanced_stats,
  can_export_audit = EXCLUDED.can_export_audit,
  can_branding = EXCLUDED.can_branding,
  sort_order = EXCLUDED.sort_order,
  stripe_price_monthly = EXCLUDED.stripe_price_monthly,
  stripe_price_annual = EXCLUDED.stripe_price_annual,
  tagline = EXCLUDED.tagline,
  updated_at = now();

-- 5. Entreprise = sur devis, aucun checkout Stripe automatique
UPDATE public.plan_limits SET
  display_name = 'Entreprise',
  annual_price_eur = NULL,
  max_members = NULL,
  sort_order = 4,
  recommended = false,
  is_custom_pricing = true,
  stripe_price_monthly = NULL,
  stripe_price_annual = NULL,
  tagline = 'Pour les organisations ayant des besoins avancés et un déploiement personnalisé.',
  updated_at = now()
WHERE plan = 'enterprise';

-- 6. Seat accounting: active members + pending (non-expired) invitations
CREATE OR REPLACE FUNCTION public.get_company_seat_usage(_company_id uuid)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT count(*)::int FROM public.company_members
   WHERE company_id = _company_id
     AND (
       status = 'active'
       OR (status = 'invited' AND (invite_expires_at IS NULL OR invite_expires_at > now()))
     );
$$;

GRANT EXECUTE ON FUNCTION public.get_company_seat_usage(uuid) TO authenticated, service_role;

-- can_add_member now uses seat usage (active + pending invites)
CREATE OR REPLACE FUNCTION public.can_add_member(_company_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare _max int; _used int;
begin
  select max_members into _max
  from public.plan_limits where plan = public.get_company_plan(_company_id);

  if _max is null then return true; end if;
  _used := public.get_company_seat_usage(_company_id);
  return _used < _max;
end $$;

-- 7. Race-safe hard enforcement at row level
CREATE OR REPLACE FUNCTION public.enforce_member_seat_quota()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare _max int; _used int;
begin
  if NEW.status not in ('active','invited') then
    return NEW;
  end if;
  if TG_OP = 'UPDATE' and OLD.status in ('active','invited') then
    return NEW; -- already counted
  end if;

  select max_members into _max
  from public.plan_limits
  where plan = public.get_company_plan(NEW.company_id);

  if _max is null then return NEW; end if;

  -- serialize concurrent seat consumption per company
  perform pg_advisory_xact_lock(hashtextextended('pvia_seats:' || NEW.company_id::text, 0));

  select count(*)::int into _used
  from public.company_members
  where company_id = NEW.company_id
    and id is distinct from NEW.id
    and (
      status = 'active'
      or (status = 'invited' and (invite_expires_at is null or invite_expires_at > now()))
    );

  if _used >= _max then
    raise exception 'SEAT_QUOTA_EXCEEDED: % / % utilisateurs', _used, _max
      using errcode = 'check_violation';
  end if;

  return NEW;
end $$;

DROP TRIGGER IF EXISTS trg_company_members_seat_quota ON public.company_members;
CREATE TRIGGER trg_company_members_seat_quota
  BEFORE INSERT OR UPDATE OF status ON public.company_members
  FOR EACH ROW EXECUTE FUNCTION public.enforce_member_seat_quota();
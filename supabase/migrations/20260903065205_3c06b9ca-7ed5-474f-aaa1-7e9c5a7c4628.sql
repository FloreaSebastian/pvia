CREATE OR REPLACE FUNCTION public.enforce_member_seat_quota()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _max int; _used int;
begin
  if NEW.status not in ('active','invited') then
    return NEW;
  end if;
  -- Déjà comptée : ancienne ligne active, ou invitation ENCORE VALIDE.
  -- Une invitation expirée ne consomme pas de siège : son activation doit donc
  -- être re-contrôlée (sinon contournement du quota après expiration).
  if TG_OP = 'UPDATE' and (
       OLD.status = 'active'
       or (OLD.status = 'invited'
           and (OLD.invite_expires_at is null or OLD.invite_expires_at > now()))
     ) then
    return NEW;
  end if;

  select max_members into _max
  from public.plan_limits
  where plan = public.get_company_plan(NEW.company_id);

  if _max is null then return NEW; end if;

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
end $function$;

REVOKE ALL ON FUNCTION public.enforce_member_seat_quota() FROM anon, authenticated, public;
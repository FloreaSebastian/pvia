
create or replace function public.company_members_governance_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _actor uuid := auth.uid();
  _company uuid := coalesce(new.company_id, old.company_id);
  _actor_is_directeur boolean;
  _remaining int;
begin
  -- Ignore cascades from a deleted company (integrity guard would block them).
  if not exists (select 1 from public.companies where id = _company) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- Serialize concurrent governance changes for this company (anti race condition).
  perform pg_advisory_xact_lock(hashtext(_company::text));

  if _actor is not null then
    _actor_is_directeur := public.is_company_owner(_company, _actor);

    if tg_op in ('UPDATE', 'DELETE')
       and old.role = 'directeur'
       and not _actor_is_directeur then
      raise exception 'Seul un Directeur peut modifier ou retirer un Directeur.'
        using errcode = '42501';
    end if;

    if tg_op in ('INSERT', 'UPDATE')
       and new.role = 'directeur'
       and not _actor_is_directeur then
      raise exception 'Seul un Directeur peut nommer un Directeur.'
        using errcode = '42501';
    end if;
  end if;

  if (tg_op = 'DELETE' and old.role = 'directeur' and old.status = 'active')
     or (tg_op = 'UPDATE' and old.role = 'directeur' and old.status = 'active'
         and (new.role <> 'directeur'
              or new.status <> 'active'
              or new.company_id <> old.company_id
              or new.user_id is distinct from old.user_id)) then
    select count(*) into _remaining
      from public.company_members
     where company_id = _company
       and role = 'directeur'
       and status = 'active'
       and id <> old.id;
    if _remaining = 0 then
      raise exception 'Cette entreprise doit conserver au moins un Directeur actif.'
        using errcode = '23514';
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_company_members_governance on public.company_members;
create trigger trg_company_members_governance
before insert or update or delete on public.company_members
for each row execute function public.company_members_governance_guard();

-- Defense in depth: RLS no longer lets a non-Directeur target a Directeur row.
drop policy if exists members_update on public.company_members;
create policy members_update on public.company_members
for update
using (
  public.is_company_admin(company_id, auth.uid())
  and (role <> 'directeur' or public.is_company_owner(company_id, auth.uid()))
)
with check (
  public.is_company_admin(company_id, auth.uid())
  and (role <> 'directeur' or public.is_company_owner(company_id, auth.uid()))
);

drop policy if exists members_delete on public.company_members;
create policy members_delete on public.company_members
for delete
using (
  public.is_company_admin(company_id, auth.uid())
  and (role <> 'directeur' or public.is_company_owner(company_id, auth.uid()))
);

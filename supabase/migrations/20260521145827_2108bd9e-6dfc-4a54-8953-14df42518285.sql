
alter table public.company_members alter column user_id drop not null;
alter table public.company_members drop constraint if exists company_members_company_id_user_id_key cascade;
create unique index if not exists ux_member_user on public.company_members(company_id, user_id) where user_id is not null;
create unique index if not exists ux_member_email on public.company_members(company_id, invited_email) where invited_email is not null and user_id is null;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare new_company uuid; cname text; pending_count int;
begin
  insert into public.profiles (id, full_name, company_name)
  values (new.id, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'company_name')
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role) values (new.id, 'admin')
  on conflict do nothing;
  update public.company_members
    set user_id = new.id, status = 'active', invited_email = null
    where invited_email = new.email and user_id is null;
  get diagnostics pending_count = row_count;
  if pending_count = 0 then
    cname := coalesce(nullif(new.raw_user_meta_data->>'company_name',''), nullif(new.raw_user_meta_data->>'full_name',''), 'Mon entreprise');
    insert into public.companies(name, email) values (cname, new.email) returning id into new_company;
    insert into public.company_members(company_id, user_id, role, status)
      values (new_company, new.id, 'owner', 'active');
  end if;
  return new;
end $$;

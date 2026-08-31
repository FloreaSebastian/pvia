create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare new_company uuid; cname text; pending_count int; tok text; tok_hash text;
begin
  insert into public.profiles (id, full_name, company_name)
  values (new.id, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'company_name')
  on conflict (id) do nothing;

  if lower(coalesce(new.email,'')) like '%@pvia.fr' then
    insert into public.user_roles (user_id, role)
    values (new.id, 'platform_admin')
    on conflict do nothing;
  end if;

  tok := new.raw_user_meta_data->>'invite_token';
  if tok is not null then
    tok_hash := encode(extensions.digest(tok, 'sha256'), 'hex');
    update public.company_members
      set user_id = new.id, status = 'active', invited_email = null, accepted_at = now(),
          invite_token_hash = null
      where invite_token_hash = tok_hash and (invite_expires_at is null or invite_expires_at > now());
    get diagnostics pending_count = row_count;
  else
    update public.company_members
      set user_id = new.id, status = 'active', invited_email = null, accepted_at = now(),
          invite_token_hash = null
      where invited_email = new.email and user_id is null;
    get diagnostics pending_count = row_count;
  end if;

  if pending_count = 0 then
    IF NOT public.can_create_company(new.id) THEN
      INSERT INTO public.audit_logs(user_id, entity_type, action, metadata)
      VALUES (new.id, 'company', 'company.create_blocked_limit',
              jsonb_build_object('email', new.email, 'reason', 'max_3_companies_per_user'));
      RETURN new;
    END IF;

    cname := coalesce(nullif(new.raw_user_meta_data->>'company_name',''), nullif(new.raw_user_meta_data->>'full_name',''), 'Mon entreprise');
    insert into public.companies(name, email) values (cname, new.email) returning id into new_company;
    insert into public.company_members(company_id, user_id, role, status)
      values (new_company, new.id, 'directeur', 'active');

    INSERT INTO public.audit_logs(user_id, company_id, entity_type, entity_id, action, metadata)
    VALUES (new.id, new_company, 'company', new_company, 'company.created',
            jsonb_build_object('email', new.email, 'via', 'signup_trigger'));
  end if;
  return new;
end
$$;
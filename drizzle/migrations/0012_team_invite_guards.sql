-- 0012 : invitations bornées au destinataire, gouvernance des adhésions par OLD.company_id,
-- mutations client des membres alignées sur l'accès écriture confirmé.

CREATE OR REPLACE FUNCTION public.invite_recipient_matches(
  _invited_email text, _status public.member_status, _user_id uuid,
  _expires_at timestamptz, _email text)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $$
  SELECT coalesce(
    _status = 'invited'
    AND _user_id IS NULL
    AND _expires_at IS NOT NULL
    AND _expires_at > now()
    AND nullif(lower(btrim(_invited_email)), '') IS NOT NULL
    AND lower(btrim(_invited_email)) = lower(btrim(coalesce(_email, ''))),
  false);
$$;
GRANT EXECUTE ON FUNCTION public.invite_recipient_matches(text, public.member_status, uuid, timestamptz, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare new_company uuid; cname text; pending_count int := 0; tok text; tok_hash text; is_sub boolean;
begin
  insert into public.profiles (id, full_name, company_name)
  values (new.id, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'company_name')
  on conflict (id) do nothing;

  if lower(coalesce(new.email,'')) like '%@pvia.fr' then
    insert into public.user_roles (user_id, role)
    values (new.id, 'platform_admin')
    on conflict do nothing;
  end if;

  -- Invitations : destinataire exact, statut invité, non rattachée, non expirée.
  -- La métadonnée seule n'active jamais rien ; un compte dont l'email n'est pas
  -- encore vérifié garde l'invitation en attente (acceptation serveur ensuite).
  tok := nullif(new.raw_user_meta_data->>'invite_token', '');
  if tok is not null then
    tok_hash := encode(extensions.digest(tok, 'sha256'), 'hex');
  end if;

  select count(*) into pending_count
    from public.company_members m
   where public.invite_recipient_matches(m.invited_email, m.status, m.user_id, m.invite_expires_at, new.email)
     and (tok_hash is null or m.invite_token_hash = tok_hash);

  if pending_count > 0 and new.email_confirmed_at is not null then
    update public.company_members m
       set user_id = new.id, status = 'active', invited_email = null, accepted_at = now(),
           invite_token_hash = null
     where public.invite_recipient_matches(m.invited_email, m.status, m.user_id, m.invite_expires_at, new.email)
       and (tok_hash is null or m.invite_token_hash = tok_hash);
  end if;

  is_sub := coalesce((new.raw_user_meta_data->>'subcontractor')::boolean, false)
            or exists (select 1 from public.subcontractor_users su
                        where lower(su.email) = lower(coalesce(new.email,'')));

  if pending_count = 0 and not is_sub then
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
  elsif pending_count = 0 and is_sub then
    INSERT INTO public.audit_logs(user_id, entity_type, action, metadata)
    VALUES (new.id, 'auth', 'user.created',
            jsonb_build_object('email', new.email, 'scope', 'subcontractor_account'));
  end if;
  return new;
end
$function$;

CREATE OR REPLACE FUNCTION public.company_members_governance_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _actor uuid := auth.uid();
  _company uuid;
  _actor_is_directeur boolean;
  _remaining int;
begin
  -- Identité d'une adhésion immuable côté client (entreprise, identifiant).
  if tg_op = 'UPDATE' and _actor is not null
     and (new.company_id is distinct from old.company_id or new.id is distinct from old.id) then
    raise exception 'L''entreprise d''une adhésion ne peut pas être modifiée.'
      using errcode = '42501';
  end if;

  -- La portée contrôlée est celle de la ligne existante pour UPDATE/DELETE.
  _company := case when tg_op = 'INSERT' then new.company_id else old.company_id end;

  if not exists (select 1 from public.companies where id = _company) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  perform pg_advisory_xact_lock(hashtext(_company::text));
  if tg_op = 'UPDATE' and new.company_id is distinct from old.company_id then
    perform pg_advisory_xact_lock(hashtext(new.company_id::text));
  end if;

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
              or new.company_id is distinct from old.company_id
              or new.user_id is distinct from old.user_id)) then
    select count(*) into _remaining
      from public.company_members
     where company_id = old.company_id
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
$function$;

DROP POLICY IF EXISTS members_update ON public.company_members;
CREATE POLICY members_update ON public.company_members
  FOR UPDATE TO authenticated
  USING (public.can_write_company_admin(company_id, auth.uid())
         AND ((role <> 'directeur'::public.company_role) OR public.is_company_owner(company_id, auth.uid())))
  WITH CHECK (public.can_write_company_admin(company_id, auth.uid())
         AND ((role <> 'directeur'::public.company_role) OR public.is_company_owner(company_id, auth.uid())));

DROP POLICY IF EXISTS members_delete ON public.company_members;
CREATE POLICY members_delete ON public.company_members
  FOR DELETE TO authenticated
  USING (public.can_write_company_admin(company_id, auth.uid())
         AND ((role <> 'directeur'::public.company_role) OR public.is_company_owner(company_id, auth.uid())));

DO $$
DECLARE
  _deleted int := 0;
  _promoted int := 0;
BEGIN
  -- 1. Supprimer le rôle 'admin' des comptes non PVIA
  WITH del AS (
    DELETE FROM public.user_roles ur
    USING auth.users u
    WHERE ur.user_id = u.id
      AND ur.role = 'admin'
      AND lower(u.email) NOT LIKE '%@pvia.fr'
    RETURNING ur.user_id
  )
  SELECT count(*) INTO _deleted FROM del;

  -- 2. Promouvoir tous les comptes @pvia.fr en platform_admin
  WITH ins AS (
    INSERT INTO public.user_roles (user_id, role)
    SELECT u.id, 'platform_admin'::public.app_role
    FROM auth.users u
    WHERE lower(u.email) LIKE '%@pvia.fr'
    ON CONFLICT (user_id, role) DO NOTHING
    RETURNING user_id
  )
  SELECT count(*) INTO _promoted FROM ins;

  -- 3. Audit global
  INSERT INTO public.audit_logs(entity_type, action, metadata)
  VALUES ('platform_admin', 'admin.role_cleanup',
          jsonb_build_object(
            'deleted_admin_roles_non_pvia', _deleted,
            'promoted_pvia_platform_admin', _promoted,
            'executed_at', now()
          ));
END $$;

-- 4. Réécrire handle_new_user : plus d'attribution automatique de 'admin'
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare new_company uuid; cname text; pending_count int; tok text; tok_hash text;
begin
  insert into public.profiles (id, full_name, company_name)
  values (new.id, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'company_name')
  on conflict (id) do nothing;

  -- Rôle plateforme : UNIQUEMENT pour les comptes @pvia.fr
  if lower(coalesce(new.email,'')) like '%@pvia.fr' then
    insert into public.user_roles (user_id, role)
    values (new.id, 'platform_admin')
    on conflict do nothing;
  end if;
  -- NB : on n'attribue plus 'admin' par défaut. Les droits entreprise
  -- viennent de company_members.role (owner/admin/manager/user).

  tok := new.raw_user_meta_data->>'invite_token';
  if tok is not null then
    tok_hash := encode(extensions.digest(tok, 'sha256'), 'hex');
    update public.company_members
      set user_id = new.id, status = 'active', invited_email = null, accepted_at = now(),
          invite_token = null, invite_token_hash = null
      where invite_token_hash = tok_hash and (invite_expires_at is null or invite_expires_at > now());
    get diagnostics pending_count = row_count;
  else
    update public.company_members
      set user_id = new.id, status = 'active', invited_email = null, accepted_at = now(),
          invite_token = null, invite_token_hash = null
      where invited_email = new.email and user_id is null;
    get diagnostics pending_count = row_count;
  end if;

  if pending_count = 0 then
    -- Anti-abus : vérifier que l'utilisateur peut créer une nouvelle entreprise
    IF NOT public.can_create_company(new.id) THEN
      INSERT INTO public.audit_logs(user_id, entity_type, action, metadata)
      VALUES (new.id, 'company', 'company.create_blocked_limit',
              jsonb_build_object('email', new.email, 'reason', 'max_3_companies_per_user'));
      RETURN new;
    END IF;

    cname := coalesce(nullif(new.raw_user_meta_data->>'company_name',''), nullif(new.raw_user_meta_data->>'full_name',''), 'Mon entreprise');
    insert into public.companies(name, email) values (cname, new.email) returning id into new_company;
    insert into public.company_members(company_id, user_id, role, status)
      values (new_company, new.id, 'owner', 'active');

    INSERT INTO public.audit_logs(user_id, company_id, entity_type, entity_id, action, metadata)
    VALUES (new.id, new_company, 'company', new_company, 'company.created',
            jsonb_build_object('email', new.email, 'via', 'signup_trigger'));
  end if;
  return new;
end $function$;

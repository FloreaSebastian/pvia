-- 0013 : l'inscription n'active JAMAIS une invitation (même email_confirmed_at
-- renseigné, l'auto-confirmation ne prouve pas la lecture de l'email).
-- Une invitation valide correspondante reste en attente, sans entreprise
-- personnelle ; l'acceptation passe par la fonction serveur exigeant une
-- preuve email (claim amr otp/magiclink). Inscription standard inchangée.
-- Définition seule : aucune ligne métier modifiée.
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

  -- Invitation valide pour ce destinataire : laissée EN ATTENTE (jamais activée ici).
  tok := nullif(new.raw_user_meta_data->>'invite_token', '');
  if tok is not null then
    tok_hash := encode(extensions.digest(tok, 'sha256'), 'hex');
  end if;

  select count(*) into pending_count
    from public.company_members m
   where public.invite_recipient_matches(m.invited_email, m.status, m.user_id, m.invite_expires_at, new.email)
     and (tok_hash is null or m.invite_token_hash = tok_hash);

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
  elsif pending_count > 0 then
    INSERT INTO public.audit_logs(user_id, entity_type, action, metadata)
    VALUES (new.id, 'auth', 'user.created',
            jsonb_build_object('email', new.email, 'scope', 'pending_invitation'));
  end if;
  return new;
end
$function$;
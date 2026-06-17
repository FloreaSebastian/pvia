
-- =========================================================================
-- Lot 1 : Refonte des rôles d'entreprise
-- Remplacement de l'enum company_role avec mapping automatique
-- =========================================================================

-- 1) Créer le nouvel enum
CREATE TYPE public.company_role_new AS ENUM (
  'directeur',
  'responsable_exploitation',
  'conducteur_travaux',
  'technicien',
  'assistant_admin',
  'lecture_seule'
);

-- 2) Supprimer les fonctions qui dépendent de l'ancien type
DROP FUNCTION IF EXISTS public.get_company_role(uuid, uuid);

-- 3) Migrer la colonne company_members.role
ALTER TABLE public.company_members
  ALTER COLUMN role DROP DEFAULT;

ALTER TABLE public.company_members
  ALTER COLUMN role TYPE public.company_role_new
  USING (
    CASE role::text
      WHEN 'owner'   THEN 'directeur'
      WHEN 'admin'   THEN 'responsable_exploitation'
      WHEN 'manager' THEN 'conducteur_travaux'
      WHEN 'user'    THEN 'technicien'
      ELSE 'technicien'
    END
  )::public.company_role_new;

ALTER TABLE public.company_members
  ALTER COLUMN role SET DEFAULT 'technicien'::public.company_role_new;

-- 4) Swap des types
DROP TYPE public.company_role;
ALTER TYPE public.company_role_new RENAME TO company_role;

-- 5) Recréer get_company_role
CREATE OR REPLACE FUNCTION public.get_company_role(_company_id uuid, _user_id uuid)
RETURNS public.company_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT role FROM public.company_members
   WHERE company_id = _company_id AND user_id = _user_id AND status = 'active'
   LIMIT 1;
$$;

-- 6) Mettre à jour les helpers de permission
CREATE OR REPLACE FUNCTION public.is_company_owner(_company_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.company_members
     WHERE company_id = _company_id AND user_id = _user_id AND status = 'active'
       AND role = 'directeur'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_company_admin(_company_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.company_members
     WHERE company_id = _company_id AND user_id = _user_id AND status = 'active'
       AND role IN ('directeur','responsable_exploitation')
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_company(_company_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.company_members
     WHERE company_id = _company_id AND user_id = _user_id AND status = 'active'
       AND role IN ('directeur','responsable_exploitation','conducteur_travaux','assistant_admin')
  );
$$;

-- 7) handle_new_user : créer les nouveaux comptes avec le rôle 'directeur'
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
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
end $$;

-- 8) can_create_company : compter les comptes 'directeur' au lieu de 'owner'
CREATE OR REPLACE FUNCTION public.can_create_company(_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE _count int;
BEGIN
  IF public.is_platform_admin(_user_id) THEN
    RETURN true;
  END IF;
  SELECT count(*) INTO _count
  FROM public.company_members
  WHERE user_id = _user_id
    AND role = 'directeur'
    AND status = 'active';
  RETURN _count < 3;
END $$;

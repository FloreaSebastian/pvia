-- ============================================================
-- P1 — Anti-abus création entreprises
-- ============================================================

-- 1) Étendre l'enum app_role
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'platform_admin';

COMMIT;

-- 2) Helper: is_platform_admin
CREATE OR REPLACE FUNCTION public.is_platform_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = 'platform_admin'
  )
$$;

-- 3) Helper: can_create_company (limite 3 par owner, bypass platform_admin)
CREATE OR REPLACE FUNCTION public.can_create_company(_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _count int;
BEGIN
  IF public.is_platform_admin(_user_id) THEN
    RETURN true;
  END IF;
  SELECT count(*) INTO _count
  FROM public.company_members
  WHERE user_id = _user_id
    AND role = 'owner'
    AND status = 'active';
  RETURN _count < 3;
END $$;

-- 4) handle_new_user : refuse la création si la limite est atteinte
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
declare new_company uuid; cname text; pending_count int; tok text; tok_hash text;
begin
  insert into public.profiles (id, full_name, company_name)
  values (new.id, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'company_name')
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role) values (new.id, 'admin')
  on conflict do nothing;

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
      -- On crée le profil mais on ne crée AUCUNE entreprise.
      -- L'utilisateur verra l'écran d'onboarding sans entreprise → géré côté UI.
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
end $$;

-- ============================================================
-- P2 — Compliance checklist (AIPD CNIL)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.compliance_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  category text NOT NULL,
  item_key text NOT NULL,
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','done','na')),
  value text,
  notes text,
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, item_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.compliance_checklist_items TO authenticated;
GRANT ALL ON public.compliance_checklist_items TO service_role;

ALTER TABLE public.compliance_checklist_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "compliance_select_admin" ON public.compliance_checklist_items
  FOR SELECT TO authenticated
  USING (public.is_company_admin(company_id, auth.uid()) OR public.is_platform_admin(auth.uid()));

CREATE POLICY "compliance_modify_admin" ON public.compliance_checklist_items
  FOR ALL TO authenticated
  USING (public.is_company_admin(company_id, auth.uid()) OR public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_company_admin(company_id, auth.uid()) OR public.is_platform_admin(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_compliance_company ON public.compliance_checklist_items(company_id);

CREATE TRIGGER compliance_set_updated_at
  BEFORE UPDATE ON public.compliance_checklist_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
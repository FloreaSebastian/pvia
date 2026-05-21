
-- 1. Invitation tokens on company_members
ALTER TABLE public.company_members
  ADD COLUMN IF NOT EXISTS invite_token text UNIQUE,
  ADD COLUMN IF NOT EXISTS invite_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS invited_by uuid;

CREATE INDEX IF NOT EXISTS idx_company_members_invite_token ON public.company_members(invite_token);
CREATE INDEX IF NOT EXISTS idx_company_members_invited_email ON public.company_members(invited_email);

-- 2. Public read policy for invitation lookup by token (limited rows via token uniqueness)
DROP POLICY IF EXISTS members_select_by_token ON public.company_members;
CREATE POLICY members_select_by_token ON public.company_members
  FOR SELECT TO anon, authenticated
  USING (invite_token IS NOT NULL AND status = 'invited' AND (invite_expires_at IS NULL OR invite_expires_at > now()));

-- 3. Update handle_new_user to also attach by token (stored in raw_user_meta_data.invite_token)
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare new_company uuid; cname text; pending_count int; tok text;
begin
  insert into public.profiles (id, full_name, company_name)
  values (new.id, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'company_name')
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role) values (new.id, 'admin')
  on conflict do nothing;

  tok := new.raw_user_meta_data->>'invite_token';
  if tok is not null then
    update public.company_members
      set user_id = new.id, status = 'active', invited_email = null, accepted_at = now(), invite_token = null
      where invite_token = tok and (invite_expires_at is null or invite_expires_at > now());
    get diagnostics pending_count = row_count;
  else
    update public.company_members
      set user_id = new.id, status = 'active', invited_email = null, accepted_at = now()
      where invited_email = new.email and user_id is null;
    get diagnostics pending_count = row_count;
  end if;

  if pending_count = 0 then
    cname := coalesce(nullif(new.raw_user_meta_data->>'company_name',''), nullif(new.raw_user_meta_data->>'full_name',''), 'Mon entreprise');
    insert into public.companies(name, email) values (cname, new.email) returning id into new_company;
    insert into public.company_members(company_id, user_id, role, status)
      values (new_company, new.id, 'owner', 'active');
  end if;
  return new;
end $function$;

-- 4. Notification trigger functions
CREATE OR REPLACE FUNCTION public.notify_pv_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare _title text; _body text; _type text := 'info';
begin
  if TG_OP = 'INSERT' then
    _title := 'Nouveau PV créé';
    _body  := 'Le PV ' || coalesce(new.numero,'') || ' a été créé.';
    _type  := 'pv_created';
  elsif TG_OP = 'UPDATE' and new.status = 'signe' and coalesce(old.status,'') <> 'signe' then
    _title := 'PV signé';
    _body  := 'Le PV ' || coalesce(new.numero,'') || ' a été signé.';
    _type  := 'pv_signed';
  else
    return new;
  end if;
  insert into public.notifications(company_id, user_id, type, title, body)
    values (new.company_id, new.owner_id, _type, _title, _body);
  return new;
end $$;

DROP TRIGGER IF EXISTS trg_notify_pv_insert ON public.pv;
CREATE TRIGGER trg_notify_pv_insert AFTER INSERT ON public.pv
  FOR EACH ROW EXECUTE FUNCTION public.notify_pv_event();
DROP TRIGGER IF EXISTS trg_notify_pv_update ON public.pv;
CREATE TRIGGER trg_notify_pv_update AFTER UPDATE OF status ON public.pv
  FOR EACH ROW EXECUTE FUNCTION public.notify_pv_event();

CREATE OR REPLACE FUNCTION public.notify_reserve_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare _title text; _body text; _type text;
begin
  if TG_OP = 'INSERT' then
    _title := 'Nouvelle réserve';
    _body  := left(coalesce(new.description,''), 140);
    _type  := 'reserve_created';
  elsif TG_OP = 'UPDATE' and new.status <> old.status then
    if new.status = 'levee' then _title := 'Réserve levée'; _type := 'reserve_lifted';
    elsif new.status = 'validee' then _title := 'Réserve validée'; _type := 'reserve_validated';
    else return new; end if;
    _body := left(coalesce(new.description,''), 140);
  else
    return new;
  end if;
  insert into public.notifications(company_id, user_id, type, title, body)
    values (new.company_id, new.owner_id, _type, _title, _body);
  return new;
end $$;

DROP TRIGGER IF EXISTS trg_notify_reserve_insert ON public.pv_reserves;
CREATE TRIGGER trg_notify_reserve_insert AFTER INSERT ON public.pv_reserves
  FOR EACH ROW EXECUTE FUNCTION public.notify_reserve_event();
DROP TRIGGER IF EXISTS trg_notify_reserve_update ON public.pv_reserves;
CREATE TRIGGER trg_notify_reserve_update AFTER UPDATE OF status ON public.pv_reserves
  FOR EACH ROW EXECUTE FUNCTION public.notify_reserve_event();

CREATE OR REPLACE FUNCTION public.notify_member_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare _title text; _body text; _type text;
begin
  if TG_OP = 'INSERT' and new.status = 'invited' then
    _title := 'Invitation envoyée';
    _body  := 'Invitation envoyée à ' || coalesce(new.invited_email,'un membre');
    _type  := 'member_invited';
  elsif TG_OP = 'UPDATE' and new.status = 'active' and old.status = 'invited' then
    _title := 'Nouveau membre';
    _body  := 'Un membre a rejoint l''équipe.';
    _type  := 'member_joined';
  else
    return new;
  end if;
  insert into public.notifications(company_id, user_id, type, title, body)
    values (new.company_id, coalesce(new.invited_by, new.user_id), _type, _title, _body);
  return new;
end $$;

DROP TRIGGER IF EXISTS trg_notify_member_insert ON public.company_members;
CREATE TRIGGER trg_notify_member_insert AFTER INSERT ON public.company_members
  FOR EACH ROW EXECUTE FUNCTION public.notify_member_event();
DROP TRIGGER IF EXISTS trg_notify_member_update ON public.company_members;
CREATE TRIGGER trg_notify_member_update AFTER UPDATE OF status ON public.company_members
  FOR EACH ROW EXECUTE FUNCTION public.notify_member_event();

-- 5. Realtime for notifications
ALTER TABLE public.notifications REPLICA IDENTITY FULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='notifications') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications';
  END IF;
END $$;

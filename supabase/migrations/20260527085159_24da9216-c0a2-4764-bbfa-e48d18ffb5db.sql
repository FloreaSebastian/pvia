
-- 1) Invite token hashing
ALTER TABLE public.company_members ADD COLUMN IF NOT EXISTS invite_token_hash text;
CREATE INDEX IF NOT EXISTS idx_company_members_invite_token_hash ON public.company_members(invite_token_hash) WHERE invite_token_hash IS NOT NULL;

-- Best-effort: clear any plaintext leftover (tokens become invalid; new invites must be re-sent).
UPDATE public.company_members SET invite_token = NULL WHERE invite_token IS NOT NULL;

-- Updated trigger: hash the incoming token before lookup.
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
    cname := coalesce(nullif(new.raw_user_meta_data->>'company_name',''), nullif(new.raw_user_meta_data->>'full_name',''), 'Mon entreprise');
    insert into public.companies(name, email) values (cname, new.email) returning id into new_company;
    insert into public.company_members(company_id, user_id, role, status)
      values (new_company, new.id, 'owner', 'active');
  end if;
  return new;
end $function$;

-- 2) Storage policies: company-scoped read/write for pv-assets
DROP POLICY IF EXISTS "pv_assets_select_company" ON storage.objects;
DROP POLICY IF EXISTS "pv_assets_insert_company" ON storage.objects;
DROP POLICY IF EXISTS "pv_assets_update_company" ON storage.objects;
DROP POLICY IF EXISTS "pv_assets_delete_company" ON storage.objects;

CREATE POLICY "pv_assets_select_company" ON storage.objects FOR SELECT
USING (
  bucket_id = 'pv-assets'
  AND auth.uid() IS NOT NULL
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR public.is_company_member(((storage.foldername(name))[1])::uuid, auth.uid())
  )
);

CREATE POLICY "pv_assets_insert_company" ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'pv-assets'
  AND auth.uid() IS NOT NULL
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR public.can_manage_company(((storage.foldername(name))[1])::uuid, auth.uid())
  )
);

CREATE POLICY "pv_assets_update_company" ON storage.objects FOR UPDATE
USING (
  bucket_id = 'pv-assets'
  AND auth.uid() IS NOT NULL
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR public.can_manage_company(((storage.foldername(name))[1])::uuid, auth.uid())
  )
);

CREATE POLICY "pv_assets_delete_company" ON storage.objects FOR DELETE
USING (
  bucket_id = 'pv-assets'
  AND auth.uid() IS NOT NULL
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR public.can_manage_company(((storage.foldername(name))[1])::uuid, auth.uid())
  )
);

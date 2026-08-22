create unique index if not exists company_members_pending_invite_uidx
  on public.company_members (company_id, lower(invited_email))
  where user_id is null and invited_email is not null;
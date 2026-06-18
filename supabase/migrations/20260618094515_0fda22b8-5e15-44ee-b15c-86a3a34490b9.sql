
-- F-07 — Calendar token expiry
ALTER TABLE public.integration_calendar_tokens
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

UPDATE public.integration_calendar_tokens
   SET expires_at = created_at + interval '1 year'
 WHERE expires_at IS NULL;

ALTER TABLE public.integration_calendar_tokens
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '1 year'),
  ALTER COLUMN expires_at SET NOT NULL;

-- F-10 — Tighten notifications UPDATE policy with company membership
DROP POLICY IF EXISTS notif_update ON public.notifications;
CREATE POLICY notif_update ON public.notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND public.is_company_member(company_id, auth.uid()))
  WITH CHECK (user_id = auth.uid() AND public.is_company_member(company_id, auth.uid()));

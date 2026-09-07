-- 1) Contexte explicite des codes OTP
ALTER TABLE public.enterprise_auth_codes
  ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'professional';

ALTER TABLE public.enterprise_auth_codes
  DROP CONSTRAINT IF EXISTS enterprise_auth_codes_audience_check;
ALTER TABLE public.enterprise_auth_codes
  ADD CONSTRAINT enterprise_auth_codes_audience_check
  CHECK (audience IN ('professional', 'subcontractor'));

CREATE INDEX IF NOT EXISTS enterprise_auth_codes_email_audience_idx
  ON public.enterprise_auth_codes (email, audience, created_at DESC);

-- 2) RLS sous-traitant : exclure explicitement les affectations annulées,
--    les relations non actives/révoquées et les entreprises non actives.
DROP POLICY IF EXISTS sc_assignments_self_read ON public.subcontractor_assignments;
CREATE POLICY sc_assignments_self_read
  ON public.subcontractor_assignments
  FOR SELECT
  TO authenticated
  USING (
    status <> 'cancelled'
    AND EXISTS (
      SELECT 1
      FROM public.subcontractor_memberships m
      JOIN public.subcontractor_users su ON su.id = m.subcontractor_user_id
      JOIN public.subcontractor_companies sc ON sc.id = m.subcontractor_company_id
      WHERE m.id = subcontractor_assignments.membership_id
        AND su.user_id = auth.uid()
        AND m.status = 'active'
        AND m.revoked_at IS NULL
        AND m.suspended_at IS NULL
        AND sc.status = 'active'
    )
  );

DROP POLICY IF EXISTS sc_messages_self_read ON public.subcontractor_messages;
CREATE POLICY sc_messages_self_read
  ON public.subcontractor_messages
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.subcontractor_assignments a
      JOIN public.subcontractor_memberships m ON m.id = a.membership_id
      JOIN public.subcontractor_users su ON su.id = m.subcontractor_user_id
      JOIN public.subcontractor_companies sc ON sc.id = m.subcontractor_company_id
      WHERE a.id = subcontractor_messages.assignment_id
        AND a.status <> 'cancelled'
        AND su.user_id = auth.uid()
        AND m.status = 'active'
        AND m.revoked_at IS NULL
        AND m.suspended_at IS NULL
        AND sc.status = 'active'
    )
  );
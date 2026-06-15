
ALTER TABLE IF EXISTS public.pv_onsite_otp RENAME TO pv_signature_otps;

ALTER TABLE public.pv_signature_otps
  ADD COLUMN IF NOT EXISTS signature_mode text NOT NULL DEFAULT 'onsite'
  CHECK (signature_mode IN ('onsite','remote'));

UPDATE public.pv_signature_otps o
   SET signature_mode = 'remote'
  FROM public.pv p
 WHERE o.pv_id = p.id
   AND p.sent_to_email IS NOT NULL
   AND p.sign_token_hash IS NOT NULL;

ALTER INDEX IF EXISTS pv_onsite_otp_pkey RENAME TO pv_signature_otps_pkey;
ALTER INDEX IF EXISTS pv_onsite_otp_expires_idx RENAME TO pv_signature_otps_expires_idx;
ALTER INDEX IF EXISTS pv_onsite_otp_pv_id_idx RENAME TO pv_signature_otps_pv_id_idx;

CREATE INDEX IF NOT EXISTS pv_signature_otps_company_idx ON public.pv_signature_otps(company_id);
CREATE INDEX IF NOT EXISTS pv_signature_otps_email_idx   ON public.pv_signature_otps(email);
CREATE INDEX IF NOT EXISTS pv_signature_otps_mode_idx    ON public.pv_signature_otps(signature_mode);

DROP POLICY IF EXISTS pv_onsite_otp_insert_member ON public.pv_signature_otps;
DROP POLICY IF EXISTS pv_onsite_otp_select_member ON public.pv_signature_otps;
DROP POLICY IF EXISTS pv_onsite_otp_update_member ON public.pv_signature_otps;

GRANT SELECT, INSERT, UPDATE ON public.pv_signature_otps TO authenticated;
GRANT ALL ON public.pv_signature_otps TO service_role;

ALTER TABLE public.pv_signature_otps ENABLE ROW LEVEL SECURITY;

CREATE POLICY pv_signature_otps_select_member ON public.pv_signature_otps
  FOR SELECT TO authenticated
  USING (public.is_company_member(company_id, auth.uid()));
CREATE POLICY pv_signature_otps_insert_member ON public.pv_signature_otps
  FOR INSERT TO authenticated
  WITH CHECK (public.is_company_member(company_id, auth.uid()));
CREATE POLICY pv_signature_otps_update_member ON public.pv_signature_otps
  FOR UPDATE TO authenticated
  USING (public.is_company_member(company_id, auth.uid()))
  WITH CHECK (public.is_company_member(company_id, auth.uid()));

DROP VIEW IF EXISTS public.pv_onsite_otp;
CREATE VIEW public.pv_onsite_otp AS
  SELECT id, pv_id, company_id, email, code_hash, attempts,
         expires_at, used_at, ip_address, user_agent, created_at
    FROM public.pv_signature_otps;
GRANT SELECT ON public.pv_onsite_otp TO authenticated, service_role;

INSERT INTO public.launch_checklist_items (category, key, label, position, status) VALUES
  ('Workflow PV', 'pv_no_reserve',           'Créer un PV sans réserve',                          200, 'todo'),
  ('Workflow PV', 'pv_blocking_reserve',     'Créer un PV avec réserve bloquante',                201, 'todo'),
  ('Workflow PV', 'pv_remote_sign_otp',      'Signature à distance — OTP client + signature',     202, 'todo'),
  ('Workflow PV', 'pv_onsite_sign_otp',      'Signature sur place — OTP client + signature',      203, 'todo'),
  ('Workflow PV', 'pv_signed_email_client',  'Email PDF signé → client reçu',                     204, 'todo'),
  ('Workflow PV', 'pv_signed_email_company', 'Email PDF signé → entreprise reçu',                 205, 'todo'),
  ('Workflow PV', 'pv_locked_after_sign',    'PV verrouillé une fois signé (édition impossible)', 206, 'todo'),
  ('Workflow PV', 'pv_delete_blocked',       'Suppression d''un PV signé refusée',                207, 'todo'),
  ('Workflow PV', 'pv_reserve_lift',         'Levée de réserves créée et signée',                 208, 'todo'),
  ('Workflow PV', 'pv_client_validation',    'Validation client d''une levée de réserves',        209, 'todo')
ON CONFLICT (key) DO NOTHING;

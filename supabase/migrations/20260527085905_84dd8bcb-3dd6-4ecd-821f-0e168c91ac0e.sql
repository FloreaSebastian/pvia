
CREATE TABLE public.launch_checklist_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key text NOT NULL UNIQUE,
  label text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  position integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'todo',
  notes text,
  tested_by uuid,
  tested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT launch_checklist_items_status_chk CHECK (status IN ('todo','passed','failed','skipped'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.launch_checklist_items TO authenticated;
GRANT ALL ON public.launch_checklist_items TO service_role;

ALTER TABLE public.launch_checklist_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "launch_checklist_admin_select" ON public.launch_checklist_items FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "launch_checklist_admin_insert" ON public.launch_checklist_items FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "launch_checklist_admin_update" ON public.launch_checklist_items FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "launch_checklist_admin_delete" ON public.launch_checklist_items FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

CREATE OR REPLACE FUNCTION public.launch_checklist_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_launch_checklist_updated_at
  BEFORE UPDATE ON public.launch_checklist_items
  FOR EACH ROW EXECUTE FUNCTION public.launch_checklist_touch_updated_at();

INSERT INTO public.launch_checklist_items (key, label, category, position) VALUES
  ('auth_company_otp',        'Auth entreprise OTP',                 'auth',         10),
  ('onboarding_siren',        'Onboarding entreprise SIREN/SIRET',   'auth',         20),
  ('pv_no_reserve',           'Création PV sans réserve',            'pv',           30),
  ('pv_with_reserves',        'Création PV avec réserves',           'pv',           40),
  ('client_signature',        'Signature client',                    'pv',           50),
  ('reserve_lift_partial',    'Levée de réserves partielle',         'reserves',     60),
  ('reserve_lift_full',       'Levée complète',                      'reserves',     70),
  ('pdf_generated',           'PDF généré',                          'documents',    80),
  ('email_sent',              'Email envoyé',                        'notifications',90),
  ('push_sent',               'Push envoyé',                         'notifications',100),
  ('webhook_delivered',       'Webhook livré',                       'integrations', 110),
  ('stripe_checkout',         'Stripe checkout',                     'billing',      120),
  ('billing_portal',          'Billing portal',                      'billing',      130),
  ('client_otp',              'Client OTP',                          'client',       140),
  ('client_space',            'Espace client',                       'client',       150),
  ('upload_logo',             'Upload logo',                         'storage',      160),
  ('storage_multi_member',    'Storage multi-membre',                'storage',      170),
  ('admin_monitoring',        'Admin monitoring',                    'admin',        180),
  ('pwa_install',             'PWA install',                         'pwa',          190),
  ('csp_google_fonts',        'CSP / Google Fonts',                  'security',     200),
  ('realtime_notifications',  'Realtime notifications',              'notifications',210);

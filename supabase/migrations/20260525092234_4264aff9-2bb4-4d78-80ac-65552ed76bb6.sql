-- company_settings: one row per company
CREATE TABLE public.company_settings (
  company_id uuid PRIMARY KEY,
  brand_color text NOT NULL DEFAULT '#3B82F6',
  email_footer text NOT NULL DEFAULT 'Cet email a été envoyé par PVIA.',
  pdf_footer text NOT NULL DEFAULT 'Document généré par PVIA.',
  pdf_watermark text NOT NULL DEFAULT '',
  locale text NOT NULL DEFAULT 'fr',
  timezone text NOT NULL DEFAULT 'Europe/Paris',
  date_format text NOT NULL DEFAULT 'fr',
  currency text NOT NULL DEFAULT 'EUR',
  custom_css text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_settings_select ON public.company_settings
  FOR SELECT USING (public.is_company_member(company_id, auth.uid()));

CREATE POLICY company_settings_insert ON public.company_settings
  FOR INSERT WITH CHECK (public.is_company_admin(company_id, auth.uid()));

CREATE POLICY company_settings_update ON public.company_settings
  FOR UPDATE USING (public.is_company_admin(company_id, auth.uid()))
  WITH CHECK (public.is_company_admin(company_id, auth.uid()));

CREATE TRIGGER company_settings_set_updated_at
  BEFORE UPDATE ON public.company_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- user_preferences: one row per user
CREATE TABLE public.user_preferences (
  user_id uuid PRIMARY KEY,
  dark_mode_enabled boolean NOT NULL DEFAULT false,
  ui_density text NOT NULL DEFAULT 'comfortable',
  animations_enabled boolean NOT NULL DEFAULT true,
  sounds_enabled boolean NOT NULL DEFAULT true,
  onboarding_tips_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_prefs_select ON public.user_preferences
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY user_prefs_insert ON public.user_preferences
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY user_prefs_update ON public.user_preferences
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE TRIGGER user_prefs_set_updated_at
  BEFORE UPDATE ON public.user_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
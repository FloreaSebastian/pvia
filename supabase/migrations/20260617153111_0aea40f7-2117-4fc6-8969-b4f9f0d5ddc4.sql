-- P2.1 / P2.3 : couleur + avancement sur chantiers
ALTER TABLE public.chantiers
  ADD COLUMN IF NOT EXISTS color text,
  ADD COLUMN IF NOT EXISTS progress_percent integer NOT NULL DEFAULT 0;

ALTER TABLE public.chantiers
  DROP CONSTRAINT IF EXISTS chantiers_progress_percent_check;
ALTER TABLE public.chantiers
  ADD CONSTRAINT chantiers_progress_percent_check
  CHECK (progress_percent >= 0 AND progress_percent <= 100);

ALTER TABLE public.chantiers
  DROP CONSTRAINT IF EXISTS chantiers_color_check;
ALTER TABLE public.chantiers
  ADD CONSTRAINT chantiers_color_check
  CHECK (color IS NULL OR color ~* '^#[0-9a-f]{6}$');

-- P2.2 : 7 statuts chantier
ALTER TABLE public.chantiers
  DROP CONSTRAINT IF EXISTS chantiers_status_check;
ALTER TABLE public.chantiers
  ADD CONSTRAINT chantiers_status_check
  CHECK (status IN ('preparation','planifie','en_cours','en_attente','receptionne','termine','archive'));

ALTER TABLE public.chantiers
  ALTER COLUMN status SET DEFAULT 'planifie';

-- P2.1 : mode couleur calendrier (réglage entreprise)
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS calendar_color_mode text NOT NULL DEFAULT 'type';

ALTER TABLE public.company_settings
  DROP CONSTRAINT IF EXISTS company_settings_calendar_color_mode_check;
ALTER TABLE public.company_settings
  ADD CONSTRAINT company_settings_calendar_color_mode_check
  CHECK (calendar_color_mode IN ('type','chantier'));


-- 1) companies: suspension fields
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_by uuid,
  ADD COLUMN IF NOT EXISTS suspension_reason text,
  ADD COLUMN IF NOT EXISTS support_status text NOT NULL DEFAULT 'active';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'companies_support_status_check') THEN
    ALTER TABLE public.companies
      ADD CONSTRAINT companies_support_status_check
      CHECK (support_status IN ('active','watched','blocked'));
  END IF;
END $$;

-- 2) support_notes
CREATE TABLE IF NOT EXISTS public.support_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  created_by uuid,
  note text NOT NULL,
  visibility text NOT NULL DEFAULT 'internal',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_notes_visibility_check CHECK (visibility IN ('internal','customer_visible'))
);
CREATE INDEX IF NOT EXISTS support_notes_company_idx ON public.support_notes(company_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_notes TO authenticated;
GRANT ALL ON public.support_notes TO service_role;

ALTER TABLE public.support_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY support_notes_admin_select ON public.support_notes
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY support_notes_admin_insert ON public.support_notes
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY support_notes_admin_update ON public.support_notes
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY support_notes_admin_delete ON public.support_notes
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 3) impersonation_sessions
CREATE TABLE IF NOT EXISTS public.impersonation_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL,
  company_id uuid NOT NULL,
  reason text,
  read_only boolean NOT NULL DEFAULT true,
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  ended_at timestamptz,
  ended_reason text
);
CREATE INDEX IF NOT EXISTS impersonation_admin_idx ON public.impersonation_sessions(admin_user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS impersonation_company_idx ON public.impersonation_sessions(company_id, started_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.impersonation_sessions TO authenticated;
GRANT ALL ON public.impersonation_sessions TO service_role;

ALTER TABLE public.impersonation_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY imp_sessions_admin_all ON public.impersonation_sessions
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

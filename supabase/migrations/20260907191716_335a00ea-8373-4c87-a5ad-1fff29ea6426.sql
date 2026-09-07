-- ============ SOUS-TRAITANTS : fondations ============

CREATE TYPE public.subcontractor_status AS ENUM ('invited','active','suspended','archived');
CREATE TYPE public.subcontractor_intervention_status AS ENUM ('to_plan','planned','confirmed','en_route','on_site','in_progress','done','cancelled');

-- 1. Entreprises sous-traitantes (propriété d'une entreprise PVIA)
CREATE TABLE public.subcontractor_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  trade_name text,
  siret text,
  address text,
  phone text,
  email text,
  website text,
  notes text,
  trades text[] NOT NULL DEFAULT '{}',
  status public.subcontractor_status NOT NULL DEFAULT 'active',
  created_by uuid,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subcontractor_companies TO authenticated;
GRANT ALL ON public.subcontractor_companies TO service_role;
ALTER TABLE public.subcontractor_companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sc_companies_admin_all" ON public.subcontractor_companies
  FOR ALL TO authenticated
  USING (public.is_company_admin(company_id, auth.uid()))
  WITH CHECK (public.is_company_admin(company_id, auth.uid()));
CREATE INDEX idx_sc_companies_company ON public.subcontractor_companies(company_id, status);

-- 2. Identités sous-traitantes (une par email, partagée entre entreprises PVIA)
CREATE TABLE public.subcontractor_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  user_id uuid,
  full_name text,
  phone text,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_sc_users_email ON public.subcontractor_users(lower(email));
CREATE INDEX idx_sc_users_user ON public.subcontractor_users(user_id);
GRANT SELECT ON public.subcontractor_users TO authenticated;
GRANT ALL ON public.subcontractor_users TO service_role;
ALTER TABLE public.subcontractor_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sc_users_self_read" ON public.subcontractor_users
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- 3. Relations entreprise PVIA <-> personne sous-traitante
CREATE TABLE public.subcontractor_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  subcontractor_company_id uuid NOT NULL REFERENCES public.subcontractor_companies(id) ON DELETE CASCADE,
  subcontractor_user_id uuid NOT NULL REFERENCES public.subcontractor_users(id) ON DELETE CASCADE,
  job_title text,
  status public.subcontractor_status NOT NULL DEFAULT 'invited',
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  preset text,
  invited_at timestamptz,
  accepted_at timestamptz,
  suspended_at timestamptz,
  revoked_at timestamptz,
  last_activity_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, subcontractor_company_id, subcontractor_user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subcontractor_memberships TO authenticated;
GRANT ALL ON public.subcontractor_memberships TO service_role;
ALTER TABLE public.subcontractor_memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sc_memberships_admin_all" ON public.subcontractor_memberships
  FOR ALL TO authenticated
  USING (public.is_company_admin(company_id, auth.uid()))
  WITH CHECK (public.is_company_admin(company_id, auth.uid()));
CREATE POLICY "sc_memberships_self_read" ON public.subcontractor_memberships
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.subcontractor_users su
    WHERE su.id = subcontractor_user_id AND su.user_id = auth.uid()
  ));
CREATE INDEX idx_sc_memberships_company ON public.subcontractor_memberships(company_id, status);
CREATE INDEX idx_sc_memberships_sc_company ON public.subcontractor_memberships(subcontractor_company_id);
CREATE INDEX idx_sc_memberships_user ON public.subcontractor_memberships(subcontractor_user_id, status);

-- 4. Invitations (jeton haché, usage unique)
CREATE TABLE public.subcontractor_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id uuid NOT NULL REFERENCES public.subcontractor_memberships(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  email text NOT NULL,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_sc_invites_token ON public.subcontractor_invites(token_hash);
CREATE INDEX idx_sc_invites_membership ON public.subcontractor_invites(membership_id, used_at);
GRANT SELECT ON public.subcontractor_invites TO authenticated;
GRANT ALL ON public.subcontractor_invites TO service_role;
ALTER TABLE public.subcontractor_invites ENABLE ROW LEVEL SECURITY;
-- Les jetons hachés ne sont jamais lus par le navigateur : accès serveur uniquement.

-- 5. Affectations aux chantiers (interventions)
CREATE TABLE public.subcontractor_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  chantier_id uuid NOT NULL REFERENCES public.chantiers(id) ON DELETE CASCADE,
  membership_id uuid NOT NULL REFERENCES public.subcontractor_memberships(id) ON DELETE CASCADE,
  technical_visit_id uuid REFERENCES public.technical_visits(id) ON DELETE SET NULL,
  mission text NOT NULL DEFAULT 'autre',
  status public.subcontractor_intervention_status NOT NULL DEFAULT 'planned',
  scheduled_at timestamptz,
  scheduled_end_at timestamptz,
  comment text,
  permission_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  chantier_event_id uuid REFERENCES public.chantier_events(id) ON DELETE SET NULL,
  confirmed_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subcontractor_assignments TO authenticated;
GRANT ALL ON public.subcontractor_assignments TO service_role;
ALTER TABLE public.subcontractor_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sc_assignments_admin_all" ON public.subcontractor_assignments
  FOR ALL TO authenticated
  USING (public.is_company_member(company_id, auth.uid()))
  WITH CHECK (public.is_company_admin(company_id, auth.uid()));
CREATE POLICY "sc_assignments_self_read" ON public.subcontractor_assignments
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.subcontractor_memberships m
    JOIN public.subcontractor_users su ON su.id = m.subcontractor_user_id
    WHERE m.id = membership_id AND su.user_id = auth.uid() AND m.status = 'active'
  ));
CREATE INDEX idx_sc_assign_company ON public.subcontractor_assignments(company_id, status);
CREATE INDEX idx_sc_assign_chantier ON public.subcontractor_assignments(chantier_id);
CREATE INDEX idx_sc_assign_membership ON public.subcontractor_assignments(membership_id, status);
CREATE INDEX idx_sc_assign_schedule ON public.subcontractor_assignments(company_id, scheduled_at);
CREATE INDEX idx_sc_assign_visit ON public.subcontractor_assignments(technical_visit_id);

-- 6. Fil d'échanges par intervention
CREATE TABLE public.subcontractor_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  assignment_id uuid NOT NULL REFERENCES public.subcontractor_assignments(id) ON DELETE CASCADE,
  author_user_id uuid,
  author_label text NOT NULL,
  author_kind text NOT NULL DEFAULT 'company',
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.subcontractor_messages TO authenticated;
GRANT ALL ON public.subcontractor_messages TO service_role;
ALTER TABLE public.subcontractor_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sc_messages_company_read" ON public.subcontractor_messages
  FOR SELECT TO authenticated USING (public.is_company_member(company_id, auth.uid()));
CREATE POLICY "sc_messages_self_read" ON public.subcontractor_messages
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.subcontractor_assignments a
    JOIN public.subcontractor_memberships m ON m.id = a.membership_id
    JOIN public.subcontractor_users su ON su.id = m.subcontractor_user_id
    WHERE a.id = assignment_id AND su.user_id = auth.uid() AND m.status = 'active'
  ));
CREATE INDEX idx_sc_messages_assignment ON public.subcontractor_messages(assignment_id, created_at);

-- 7. updated_at
CREATE TRIGGER trg_sc_companies_updated BEFORE UPDATE ON public.subcontractor_companies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_sc_users_updated BEFORE UPDATE ON public.subcontractor_users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_sc_memberships_updated BEFORE UPDATE ON public.subcontractor_memberships
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_sc_assignments_updated BEFORE UPDATE ON public.subcontractor_assignments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 8. Helper : la personne connectée est-elle sous-traitant actif de cette entreprise ?
CREATE OR REPLACE FUNCTION public.is_active_subcontractor(_company_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.subcontractor_memberships m
    JOIN public.subcontractor_users su ON su.id = m.subcontractor_user_id
    JOIN public.subcontractor_companies sc ON sc.id = m.subcontractor_company_id
    WHERE m.company_id = _company_id
      AND su.user_id = _user_id
      AND m.status = 'active'
      AND m.revoked_at IS NULL
      AND sc.status = 'active'
  )
$$;
-- Changement d'offre autonome : colonnes additives + journal des demandes.
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS stripe_schedule_id text,
  ADD COLUMN IF NOT EXISTS scheduled_price_id text,
  ADD COLUMN IF NOT EXISTS scheduled_plan text,
  ADD COLUMN IF NOT EXISTS scheduled_interval text,
  ADD COLUMN IF NOT EXISTS scheduled_change_at timestamptz,
  ADD COLUMN IF NOT EXISTS pending_price_id text,
  ADD COLUMN IF NOT EXISTS pending_expires_at timestamptz;

CREATE TABLE public.billing_plan_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL,
  environment text NOT NULL CHECK (environment IN ('sandbox','live')),
  stripe_subscription_id text NOT NULL,
  from_price_id text NOT NULL,
  to_price_id text NOT NULL,
  kind text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('immediate','scheduled')),
  status text NOT NULL DEFAULT 'previewed' CHECK (status IN
    ('previewed','processing','applied','scheduled','payment_pending','payment_failed',
     'canceled','expired','superseded','failed')),
  proration_date bigint,
  expected_schedule_id text,
  preview jsonb NOT NULL DEFAULT '{}'::jsonb,
  effective_at timestamptz,
  stripe_schedule_id text,
  stripe_invoice_id text,
  hosted_invoice_url text,
  error_code text,
  expires_at timestamptz NOT NULL,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.billing_plan_changes TO authenticated;
GRANT ALL ON public.billing_plan_changes TO service_role;
ALTER TABLE public.billing_plan_changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY billing_plan_changes_select_admin ON public.billing_plan_changes
  FOR SELECT TO authenticated USING (public.is_company_admin(company_id, auth.uid()));

-- Une seule confirmation en cours par entreprise et environnement (double clic, onglets).
CREATE UNIQUE INDEX billing_plan_changes_one_processing
  ON public.billing_plan_changes(company_id, environment) WHERE status = 'processing';
CREATE INDEX billing_plan_changes_sub ON public.billing_plan_changes(stripe_subscription_id, status);

CREATE TRIGGER trg_billing_plan_changes_updated BEFORE UPDATE ON public.billing_plan_changes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- PV NUMBERING SETTINGS
-- ============================================================
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS pv_number_prefix text NOT NULL DEFAULT 'PV',
  ADD COLUMN IF NOT EXISTS pv_number_include_year boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS pv_number_next integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS pv_number_digits integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS pv_number_separator text NOT NULL DEFAULT '-';

-- Unique constraint to prevent duplicates per company
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pv_company_numero_unique'
  ) THEN
    ALTER TABLE public.pv ADD CONSTRAINT pv_company_numero_unique UNIQUE (company_id, numero);
  END IF;
END $$;

-- Atomic numbering RPC
CREATE OR REPLACE FUNCTION public.generate_next_pv_number(_company_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _prefix text;
  _include_year boolean;
  _next int;
  _digits int;
  _sep text;
  _year text;
  _numero text;
BEGIN
  -- Ensure settings row exists
  INSERT INTO public.company_settings (company_id)
  VALUES (_company_id)
  ON CONFLICT (company_id) DO NOTHING;

  -- Lock the row for the duration of the transaction
  SELECT pv_number_prefix, pv_number_include_year, pv_number_next, pv_number_digits, pv_number_separator
    INTO _prefix, _include_year, _next, _digits, _sep
  FROM public.company_settings
  WHERE company_id = _company_id
  FOR UPDATE;

  IF _next IS NULL THEN _next := 1; END IF;
  IF _digits IS NULL OR _digits < 1 THEN _digits := 5; END IF;
  IF _sep IS NULL THEN _sep := '-'; END IF;
  IF _prefix IS NULL OR _prefix = '' THEN _prefix := 'PV'; END IF;

  _year := to_char(now() AT TIME ZONE 'utc', 'YYYY');

  IF _include_year THEN
    _numero := _prefix || _sep || _year || _sep || lpad(_next::text, _digits, '0');
  ELSE
    _numero := _prefix || _sep || lpad(_next::text, _digits, '0');
  END IF;

  UPDATE public.company_settings
    SET pv_number_next = _next + 1,
        updated_at = now()
    WHERE company_id = _company_id;

  RETURN _numero;
END
$$;

REVOKE ALL ON FUNCTION public.generate_next_pv_number(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_next_pv_number(uuid) TO authenticated, service_role;

-- ============================================================
-- RESERVE LIFT REPORTS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.reserve_lift_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  pv_id uuid NOT NULL,
  numero text NOT NULL,
  status text NOT NULL DEFAULT 'brouillon',
  comment text,
  company_signature text,
  client_signature text,
  require_client_signature boolean NOT NULL DEFAULT false,
  signed_at timestamptz,
  pdf_url text,
  pdf_generated_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reserve_lift_reports_company_idx ON public.reserve_lift_reports(company_id);
CREATE INDEX IF NOT EXISTS reserve_lift_reports_pv_idx ON public.reserve_lift_reports(pv_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reserve_lift_company_numero_unique') THEN
    ALTER TABLE public.reserve_lift_reports
      ADD CONSTRAINT reserve_lift_company_numero_unique UNIQUE (company_id, numero);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.reserve_lift_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.reserve_lift_reports(id) ON DELETE CASCADE,
  reserve_id uuid NOT NULL,
  old_status text,
  new_status text NOT NULL DEFAULT 'levee',
  comment text,
  photo_urls text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reserve_lift_items_report_idx ON public.reserve_lift_items(report_id);
CREATE INDEX IF NOT EXISTS reserve_lift_items_reserve_idx ON public.reserve_lift_items(reserve_id);

-- updated_at trigger
DROP TRIGGER IF EXISTS reserve_lift_reports_updated_at ON public.reserve_lift_reports;
CREATE TRIGGER reserve_lift_reports_updated_at
  BEFORE UPDATE ON public.reserve_lift_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.reserve_lift_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reserve_lift_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reserve_lift_reports_select ON public.reserve_lift_reports;
CREATE POLICY reserve_lift_reports_select ON public.reserve_lift_reports
  FOR SELECT USING (public.is_company_member(company_id, auth.uid()));

DROP POLICY IF EXISTS reserve_lift_reports_insert ON public.reserve_lift_reports;
CREATE POLICY reserve_lift_reports_insert ON public.reserve_lift_reports
  FOR INSERT WITH CHECK (public.can_manage_company(company_id, auth.uid()));

DROP POLICY IF EXISTS reserve_lift_reports_update ON public.reserve_lift_reports;
CREATE POLICY reserve_lift_reports_update ON public.reserve_lift_reports
  FOR UPDATE USING (public.can_manage_company(company_id, auth.uid()))
  WITH CHECK (public.can_manage_company(company_id, auth.uid()));

DROP POLICY IF EXISTS reserve_lift_reports_delete ON public.reserve_lift_reports;
CREATE POLICY reserve_lift_reports_delete ON public.reserve_lift_reports
  FOR DELETE USING (public.is_company_admin(company_id, auth.uid()));

-- Items follow parent report
DROP POLICY IF EXISTS reserve_lift_items_select ON public.reserve_lift_items;
CREATE POLICY reserve_lift_items_select ON public.reserve_lift_items
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.reserve_lift_reports r
    WHERE r.id = reserve_lift_items.report_id
      AND public.is_company_member(r.company_id, auth.uid())
  ));

DROP POLICY IF EXISTS reserve_lift_items_write ON public.reserve_lift_items;
CREATE POLICY reserve_lift_items_write ON public.reserve_lift_items
  FOR ALL USING (EXISTS (
    SELECT 1 FROM public.reserve_lift_reports r
    WHERE r.id = reserve_lift_items.report_id
      AND public.can_manage_company(r.company_id, auth.uid())
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM public.reserve_lift_reports r
    WHERE r.id = reserve_lift_items.report_id
      AND public.can_manage_company(r.company_id, auth.uid())
  ));

-- Webhook trigger
CREATE OR REPLACE FUNCTION public.webhook_on_reserve_lift_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _evt text; _payload jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    _evt := 'reserve_lift.created';
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'signe' AND COALESCE(OLD.status,'') <> 'signe' THEN
    _evt := 'reserve_lift.signed';
  ELSE
    RETURN NEW;
  END IF;

  _payload := jsonb_build_object(
    'event', _evt,
    'occurred_at', to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'reserve_lift', jsonb_build_object(
      'id', NEW.id,
      'numero', NEW.numero,
      'status', NEW.status,
      'pv_id', NEW.pv_id,
      'company_id', NEW.company_id,
      'signed_at', NEW.signed_at
    )
  );
  PERFORM public.enqueue_webhook_event(NEW.company_id, _evt, _payload);
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS reserve_lift_reports_webhook_ins ON public.reserve_lift_reports;
CREATE TRIGGER reserve_lift_reports_webhook_ins
  AFTER INSERT ON public.reserve_lift_reports
  FOR EACH ROW EXECUTE FUNCTION public.webhook_on_reserve_lift_event();

DROP TRIGGER IF EXISTS reserve_lift_reports_webhook_upd ON public.reserve_lift_reports;
CREATE TRIGGER reserve_lift_reports_webhook_upd
  AFTER UPDATE ON public.reserve_lift_reports
  FOR EACH ROW EXECUTE FUNCTION public.webhook_on_reserve_lift_event();

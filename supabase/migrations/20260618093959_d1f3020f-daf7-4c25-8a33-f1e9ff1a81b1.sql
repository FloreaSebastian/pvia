
-- ============================================================
-- F-02 — Immutability of signed reserve-lift reports
-- ============================================================
CREATE OR REPLACE FUNCTION public.reserve_lift_is_locked(_report public.reserve_lift_reports)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT _report.status = 'signe'
      OR _report.client_signature IS NOT NULL
      OR _report.client_validated_at IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.reserve_lift_block_locked_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_service boolean := (current_setting('request.jwt.claims', true)::jsonb->>'role') = 'service_role';
BEGIN
  IF v_is_service THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF public.reserve_lift_is_locked(OLD) THEN
      RAISE EXCEPTION 'RESERVE_LIFT_LOCKED: Cette levée de réserves est signée et ne peut plus être modifiée.'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND public.reserve_lift_is_locked(OLD) THEN
    -- Allow only no-op timestamp/system flag touches; block any mutation otherwise.
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.numero IS DISTINCT FROM OLD.numero
       OR NEW.comment IS DISTINCT FROM OLD.comment
       OR NEW.company_signature IS DISTINCT FROM OLD.company_signature
       OR NEW.client_signature IS DISTINCT FROM OLD.client_signature
       OR NEW.technician_signature IS DISTINCT FROM OLD.technician_signature
       OR NEW.technician_name IS DISTINCT FROM OLD.technician_name
       OR NEW.signer_user_id IS DISTINCT FROM OLD.signer_user_id
       OR NEW.signer_name IS DISTINCT FROM OLD.signer_name
       OR NEW.signer_role IS DISTINCT FROM OLD.signer_role
       OR NEW.signer_email IS DISTINCT FROM OLD.signer_email
       OR NEW.signer_signature IS DISTINCT FROM OLD.signer_signature
       OR NEW.signer_signed_at IS DISTINCT FROM OLD.signer_signed_at
       OR NEW.signed_at IS DISTINCT FROM OLD.signed_at
       OR NEW.validation_mode IS DISTINCT FROM OLD.validation_mode
       OR NEW.client_validated_at IS DISTINCT FROM OLD.client_validated_at
       OR NEW.client_signature_otp_id IS DISTINCT FROM OLD.client_signature_otp_id
       OR NEW.pv_id IS DISTINCT FROM OLD.pv_id
       OR NEW.company_id IS DISTINCT FROM OLD.company_id THEN
      RAISE EXCEPTION 'RESERVE_LIFT_LOCKED: Cette levée de réserves est signée et ne peut plus être modifiée.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.reserve_lift_child_block_locked()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report_id uuid;
  v_report public.reserve_lift_reports;
  v_is_service boolean := (current_setting('request.jwt.claims', true)::jsonb->>'role') = 'service_role';
BEGIN
  IF v_is_service THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_TABLE_NAME = 'reserve_lift_items' THEN
    v_report_id := COALESCE((NEW).report_id, (OLD).report_id);
  ELSIF TG_TABLE_NAME = 'reserve_lift_item_photos' THEN
    SELECT report_id INTO v_report_id
    FROM public.reserve_lift_items
    WHERE id = COALESCE((NEW).reserve_lift_item_id, (OLD).reserve_lift_item_id);
  END IF;

  IF v_report_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT * INTO v_report FROM public.reserve_lift_reports WHERE id = v_report_id;
  IF v_report.id IS NOT NULL AND public.reserve_lift_is_locked(v_report) THEN
    RAISE EXCEPTION 'RESERVE_LIFT_LOCKED: Cette levée de réserves est signée et ne peut plus être modifiée.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END
$$;

DROP TRIGGER IF EXISTS trg_reserve_lift_block_locked_changes ON public.reserve_lift_reports;
CREATE TRIGGER trg_reserve_lift_block_locked_changes
BEFORE UPDATE OR DELETE ON public.reserve_lift_reports
FOR EACH ROW EXECUTE FUNCTION public.reserve_lift_block_locked_changes();

DROP TRIGGER IF EXISTS trg_reserve_lift_items_block_locked ON public.reserve_lift_items;
CREATE TRIGGER trg_reserve_lift_items_block_locked
BEFORE INSERT OR UPDATE OR DELETE ON public.reserve_lift_items
FOR EACH ROW EXECUTE FUNCTION public.reserve_lift_child_block_locked();

DROP TRIGGER IF EXISTS trg_reserve_lift_item_photos_block_locked ON public.reserve_lift_item_photos;
CREATE TRIGGER trg_reserve_lift_item_photos_block_locked
BEFORE INSERT OR UPDATE OR DELETE ON public.reserve_lift_item_photos
FOR EACH ROW EXECUTE FUNCTION public.reserve_lift_child_block_locked();

-- ============================================================
-- F-01 — Tighten reserve_lift_reports INSERT policy
-- ============================================================
DROP POLICY IF EXISTS reserve_lift_reports_insert ON public.reserve_lift_reports;
CREATE POLICY reserve_lift_reports_insert ON public.reserve_lift_reports
  FOR INSERT TO authenticated
  WITH CHECK (
    public.can_manage_company(company_id, auth.uid())
    AND public.is_company_member(company_id, auth.uid())
  );

-- ============================================================
-- F-06 — Explicit deny-all on internal-only tables
-- ============================================================
DROP POLICY IF EXISTS client_auth_codes_deny_anon_auth ON public.client_auth_codes;
CREATE POLICY client_auth_codes_deny_anon_auth ON public.client_auth_codes
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS enterprise_auth_codes_deny_anon_auth ON public.enterprise_auth_codes;
CREATE POLICY enterprise_auth_codes_deny_anon_auth ON public.enterprise_auth_codes
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS rate_limits_deny_anon_auth ON public.rate_limits;
CREATE POLICY rate_limits_deny_anon_auth ON public.rate_limits
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

-- ============================================================
-- F-11 — webhook_deliveries: explicit deny for anon, restrictive
-- ============================================================
DROP POLICY IF EXISTS webhook_deliveries_deny_anon ON public.webhook_deliveries;
CREATE POLICY webhook_deliveries_deny_anon ON public.webhook_deliveries
  AS RESTRICTIVE FOR ALL TO anon
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS webhook_deliveries_deny_writes ON public.webhook_deliveries;
CREATE POLICY webhook_deliveries_deny_writes ON public.webhook_deliveries
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (false);

-- ============================================================
-- F-04 — Best-effort backfill of audit_logs.company_id
-- ============================================================
UPDATE public.audit_logs al
SET company_id = sub.company_id
FROM (
  SELECT DISTINCT ON (cm.user_id) cm.user_id, cm.company_id
  FROM public.company_members cm
  WHERE cm.status = 'active'
  ORDER BY cm.user_id, cm.created_at ASC
) sub
WHERE al.company_id IS NULL
  AND al.user_id IS NOT NULL
  AND al.user_id = sub.user_id;

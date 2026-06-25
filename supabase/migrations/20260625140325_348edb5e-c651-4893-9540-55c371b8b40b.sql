
-- Trigger DB pour bloquer définitivement les modifications des champs officiels
-- de l'entreprise utilisatrice une fois validée. Le service_role peut toujours
-- mettre à jour via syncCompanyFromSiren.

CREATE OR REPLACE FUNCTION public.companies_block_official_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_is_service boolean := COALESCE((current_setting('request.jwt.claims', true)::jsonb->>'role') = 'service_role', false);
BEGIN
  IF v_is_service THEN
    RETURN NEW;
  END IF;

  IF COALESCE(OLD.company_verified, false) = true THEN
    IF NEW.name IS DISTINCT FROM OLD.name
       OR NEW.legal_form IS DISTINCT FROM OLD.legal_form
       OR NEW.siren IS DISTINCT FROM OLD.siren
       OR NEW.siret IS DISTINCT FROM OLD.siret
       OR NEW.vat_number IS DISTINCT FROM OLD.vat_number THEN
      RAISE EXCEPTION 'COMPANY_OFFICIAL_LOCKED: Les informations officielles de l''entreprise sont verrouillées.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Even when not yet verified: SIRET/SIREN, once set, are immutable from user side.
  IF OLD.siret IS NOT NULL AND OLD.siret <> '' AND NEW.siret IS DISTINCT FROM OLD.siret THEN
    RAISE EXCEPTION 'COMPANY_SIRET_LOCKED: Le SIRET de l''entreprise ne peut pas être modifié.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.siren IS NOT NULL AND OLD.siren <> '' AND NEW.siren IS DISTINCT FROM OLD.siren THEN
    RAISE EXCEPTION 'COMPANY_SIREN_LOCKED: Le SIREN de l''entreprise ne peut pas être modifié.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS companies_block_official_changes_trg ON public.companies;
CREATE TRIGGER companies_block_official_changes_trg
  BEFORE UPDATE ON public.companies
  FOR EACH ROW
  EXECUTE FUNCTION public.companies_block_official_changes();

-- Visites techniques BTP multi-lots : extension additive et rétrocompatible.
ALTER TABLE public.technical_visits ADD COLUMN IF NOT EXISTS lots text[] NOT NULL DEFAULT '{}';
COMMENT ON COLUMN public.technical_visits.lots IS 'Lots métier d''une visite BTP composée (visit_type = btp). Vide pour les visites historiques PV/PAC.';

ALTER TABLE public.technical_visits DROP CONSTRAINT IF EXISTS technical_visits_visit_type_check;
ALTER TABLE public.technical_visits ADD CONSTRAINT technical_visits_visit_type_check
  CHECK (visit_type = ANY (ARRAY['photovoltaique','pac_air_air','pac_air_eau','btp']));

ALTER TABLE public.technical_visits ADD CONSTRAINT technical_visits_lots_check
  CHECK (lots <@ ARRAY['photovoltaique','pac_air_air','pac_air_eau','electricite','plomberie','ventilation','isolation_facade','toiture','renovation']::text[]
         AND (visit_type <> 'btp' OR cardinality(lots) >= 1)) NOT VALID;
ALTER TABLE public.technical_visits VALIDATE CONSTRAINT technical_visits_lots_check;

ALTER TABLE public.technical_visit_constraints ADD COLUMN IF NOT EXISTS location text;
ALTER TABLE public.technical_visit_constraints ADD COLUMN IF NOT EXISTS responsible text;
ALTER TABLE public.technical_visit_constraints ADD COLUMN IF NOT EXISTS lot text;

-- Nouvelle surcharge avec lots ; l'ancienne signature (8 arguments) reste inchangée pour l'application déjà publiée.
CREATE OR REPLACE FUNCTION public.create_technical_visit_atomic(
  _company_id uuid, _client_id uuid, _visit_type text, _idempotency_key text,
  _chantier_id uuid, _new_chantier jsonb, _planning jsonb, _event_title text, _lots text[]
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  _res jsonb;
BEGIN
  IF _visit_type = 'btp' AND coalesce(cardinality(_lots), 0) < 1 THEN RAISE EXCEPTION 'VT_LOTS_REQUIRED'; END IF;
  _res := public.create_technical_visit_atomic(_company_id, _client_id, _visit_type, _idempotency_key,
    _chantier_id, _new_chantier, _planning, _event_title);
  IF coalesce((_res->>'reused')::boolean, false) = false THEN
    UPDATE technical_visits SET lots = coalesce(_lots, '{}')
     WHERE id = (_res->>'id')::uuid AND company_id = _company_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'VT_FORBIDDEN'; END IF;
  END IF;
  RETURN _res;
END;
$$;

REVOKE ALL ON FUNCTION public.create_technical_visit_atomic(uuid, uuid, text, text, uuid, jsonb, jsonb, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_technical_visit_atomic(uuid, uuid, text, text, uuid, jsonb, jsonb, text, text[]) TO authenticated;
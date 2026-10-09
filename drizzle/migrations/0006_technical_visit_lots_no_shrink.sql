-- Un lot ne peut jamais être retiré d'une visite (même par mise à jour directe), ni le type changé vers/depuis BTP.
CREATE OR REPLACE FUNCTION public.technical_visit_lots_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT (OLD.lots <@ NEW.lots) THEN RAISE EXCEPTION 'VT_LOTS_SHRINK'; END IF;
  IF NEW.visit_type IS DISTINCT FROM OLD.visit_type THEN RAISE EXCEPTION 'VT_LOTS_INVALID'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS technical_visits_lots_guard ON public.technical_visits;
CREATE TRIGGER technical_visits_lots_guard
  BEFORE UPDATE OF lots, visit_type ON public.technical_visits
  FOR EACH ROW EXECUTE FUNCTION public.technical_visit_lots_guard();
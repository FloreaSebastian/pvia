
-- P2.5 — Update PV → chantier_events automation
-- Existing trigger chantier_event_from_pv already creates system_pv_created / system_pv_signed
-- (status=termine). We extend it: on PV signé, also schedule a planning event:
--   - sans réserves → "Réception chantier" (status=prevu) dated J+0
--   - avec réserves → "Levée de réserves" (status=prevu) dated J+14
-- And add a new trigger on pv: when reserve_lift_status transitions to 'completed',
-- create a "Clôture chantier" event.

CREATE OR REPLACE FUNCTION public.chantier_event_from_pv()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _title text; _type text;
BEGIN
  IF NEW.chantier_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    _title := 'PV créé ' || coalesce(NEW.numero, '');
    _type := 'system_pv_created';
    INSERT INTO public.chantier_events
      (company_id, chantier_id, client_id, title, event_type, status, start_at, all_day, created_by)
    VALUES
      (NEW.company_id, NEW.chantier_id, NEW.client_id, _title, _type, 'termine', now(), false, NEW.owner_id);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'signe' AND coalesce(OLD.status,'') <> 'signe' THEN
    -- Historical "PV signé" entry (existing behaviour)
    _title := 'PV signé ' || coalesce(NEW.numero, '');
    _type := 'system_pv_signed';
    INSERT INTO public.chantier_events
      (company_id, chantier_id, client_id, title, event_type, status, start_at, all_day, created_by)
    VALUES
      (NEW.company_id, NEW.chantier_id, NEW.client_id, _title, _type, 'termine', now(), false, NEW.owner_id);

    -- P2.5: scheduled follow-up event
    IF coalesce(NEW.reception_with_reserves, false) = true THEN
      INSERT INTO public.chantier_events
        (company_id, chantier_id, client_id, title, description, event_type, status, start_at, all_day, created_by)
      VALUES
        (NEW.company_id, NEW.chantier_id, NEW.client_id,
         'Levée de réserves ' || coalesce(NEW.numero, ''),
         'Créé automatiquement à la signature du PV avec réserves.',
         'levee_reserves', 'prevu',
         (now() + interval '14 days'), false, NEW.owner_id);
    ELSE
      INSERT INTO public.chantier_events
        (company_id, chantier_id, client_id, title, description, event_type, status, start_at, all_day, created_by)
      VALUES
        (NEW.company_id, NEW.chantier_id, NEW.client_id,
         'Réception chantier ' || coalesce(NEW.numero, ''),
         'Créé automatiquement à la signature du PV sans réserves.',
         'reception', 'termine',
         now(), false, NEW.owner_id);
    END IF;
    RETURN NEW;
  END IF;
  RETURN NEW;
END $function$;

-- Clôture chantier when all reserves validated/completed
CREATE OR REPLACE FUNCTION public.chantier_event_on_pv_completed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.chantier_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.reserve_lift_status = 'completed'
     AND coalesce(OLD.reserve_lift_status, '') <> 'completed' THEN
    INSERT INTO public.chantier_events
      (company_id, chantier_id, client_id, title, description, event_type, status, start_at, all_day, created_by)
    VALUES
      (NEW.company_id, NEW.chantier_id, NEW.client_id,
       'Clôture chantier ' || coalesce(NEW.numero, ''),
       'Créé automatiquement : toutes les réserves ont été levées.',
       'cloture', 'termine',
       now(), false, NEW.owner_id);
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_chantier_event_on_pv_completed ON public.pv;
CREATE TRIGGER trg_chantier_event_on_pv_completed
AFTER UPDATE OF reserve_lift_status ON public.pv
FOR EACH ROW
EXECUTE FUNCTION public.chantier_event_on_pv_completed();

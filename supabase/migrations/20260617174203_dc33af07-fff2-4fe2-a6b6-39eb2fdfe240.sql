-- Calendar link to source reserve
ALTER TABLE public.chantier_events
  ADD COLUMN IF NOT EXISTS source_reserve_id uuid REFERENCES public.pv_reserves(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_chantier_events_source_reserve ON public.chantier_events(source_reserve_id);

-- Sync trigger: when reserve gets/changes assigned_to or due_date, upsert a calendar event
CREATE OR REPLACE FUNCTION public.sync_reserve_calendar_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_chantier uuid;
  v_client uuid;
  v_numero text;
  v_event uuid;
  v_color text;
  v_type text;
  v_status text;
BEGIN
  IF NEW.assigned_to IS NULL OR NEW.due_date IS NULL THEN
    -- If unset, mark linked event as terminé (don't delete to preserve history)
    UPDATE public.chantier_events SET status = 'termine'
    WHERE source_reserve_id = NEW.id AND status <> 'termine';
    RETURN NEW;
  END IF;

  SELECT chantier_id, client_id, numero INTO v_chantier, v_client, v_numero
  FROM public.pv WHERE id = NEW.pv_id;

  -- Validated → mark event done
  IF NEW.status = 'validee' THEN
    UPDATE public.chantier_events SET status = 'termine'
    WHERE source_reserve_id = NEW.id;
    RETURN NEW;
  END IF;

  -- Rejected → SAV event (separate)
  IF NEW.status = 'rejetee' THEN
    INSERT INTO public.chantier_events
      (company_id, chantier_id, client_id, title, description, event_type, status, start_at, all_day, created_by, assigned_to, source_reserve_id, color)
    VALUES
      (NEW.company_id, v_chantier, v_client,
       'SAV — Réserve rejetée ' || coalesce(v_numero, ''),
       left(coalesce(NEW.description,''), 200),
       'sav', 'prevu',
       (NEW.due_date::timestamptz), true, NEW.owner_id, NEW.assigned_to, NEW.id,
       '#dc2626');
    RETURN NEW;
  END IF;

  v_color := CASE
    WHEN NEW.priority = 'high' OR NEW.severity = 'majeure' THEN '#dc2626'
    WHEN NEW.priority = 'low' THEN '#10b981'
    ELSE '#f59e0b'
  END;
  v_type := 'controle_qualite';
  v_status := CASE WHEN NEW.status IN ('levee','en_attente_validation') THEN 'termine' ELSE 'prevu' END;

  SELECT id INTO v_event FROM public.chantier_events
  WHERE source_reserve_id = NEW.id LIMIT 1;

  IF v_event IS NULL THEN
    INSERT INTO public.chantier_events
      (company_id, chantier_id, client_id, title, description, event_type, status, start_at, all_day, created_by, assigned_to, source_reserve_id, color)
    VALUES
      (NEW.company_id, v_chantier, v_client,
       'Réserve à traiter — PV ' || coalesce(v_numero, ''),
       left(coalesce(NEW.description,''), 200),
       v_type, v_status,
       (NEW.due_date::timestamptz), true, NEW.owner_id, NEW.assigned_to, NEW.id,
       v_color);
  ELSE
    UPDATE public.chantier_events
    SET assigned_to = NEW.assigned_to,
        start_at = NEW.due_date::timestamptz,
        status = v_status,
        color = v_color,
        description = left(coalesce(NEW.description,''), 200),
        updated_at = now()
    WHERE id = v_event;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_reserve_calendar ON public.pv_reserves;
CREATE TRIGGER trg_sync_reserve_calendar
AFTER INSERT OR UPDATE OF assigned_to, due_date, status ON public.pv_reserves
FOR EACH ROW EXECUTE FUNCTION public.sync_reserve_calendar_event();

-- Extend reserve event notifications (lifted/validated/rejected)
CREATE OR REPLACE FUNCTION public.notify_reserve_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare _title text; _body text; _type text;
begin
  if TG_OP = 'INSERT' then
    _title := 'Nouvelle réserve';
    _body  := left(coalesce(new.description,''), 140);
    _type  := 'reserve_created';
  elsif TG_OP = 'UPDATE' and new.status <> old.status then
    if new.status = 'levee' then _title := 'Réserve levée'; _type := 'reserve_lifted';
    elsif new.status = 'validee' then _title := 'Réserve validée'; _type := 'reserve_validated';
    elsif new.status = 'rejetee' then _title := 'Réserve rejetée'; _type := 'reserve_rejected';
    elsif new.status = 'en_attente_validation' then _title := 'Réserve en attente de validation'; _type := 'reserve_pending_validation';
    else return new; end if;
    _body := left(coalesce(new.description,''), 140);
  else
    return new;
  end if;
  insert into public.notifications(company_id, user_id, type, title, body)
    values (new.company_id, new.owner_id, _type, _title, _body);
  -- Also notify assignee on lift/validation/rejection if different
  if new.assigned_to is not null and new.assigned_to <> new.owner_id and TG_OP = 'UPDATE' then
    insert into public.notifications(company_id, user_id, type, title, body)
      values (new.company_id, new.assigned_to, _type, _title, _body);
  end if;
  return new;
end $$;
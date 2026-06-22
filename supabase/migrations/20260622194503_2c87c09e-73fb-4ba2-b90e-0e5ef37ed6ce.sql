CREATE OR REPLACE FUNCTION public.chantier_auto_close_from_pv()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prev_status text;
  v_open_other int;
BEGIN
  IF NEW.chantier_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.status <> 'signe' OR COALESCE(OLD.status,'') = 'signe' THEN RETURN NEW; END IF;

  SELECT status INTO v_prev_status FROM public.chantiers WHERE id = NEW.chantier_id;
  IF v_prev_status IN ('termine','archive') THEN RETURN NEW; END IF;

  -- Compte les réserves non clôturées des AUTRES PV du même chantier
  SELECT count(*) INTO v_open_other
    FROM public.pv_reserves r
    JOIN public.pv p ON p.id = r.pv_id
   WHERE p.chantier_id = NEW.chantier_id
     AND r.pv_id <> NEW.id
     AND r.status NOT IN ('validee','rejetee');

  IF COALESCE(NEW.reception_with_reserves, false) = false AND v_open_other = 0 THEN
    -- Cas 1 : PV signé sans réserve ET aucune autre réserve ouverte → réception + clôture
    UPDATE public.chantiers
       SET status = 'termine',
           received_at = COALESCE(received_at, NEW.signed_at, now()),
           closed_at = now(),
           closure_origin = 'pv_no_reserve',
           updated_at = now()
     WHERE id = NEW.chantier_id;
    PERFORM public._chantier_audit(NEW.company_id, NEW.owner_id, NEW.chantier_id,
      'chantier.received_from_pv', jsonb_build_object('pv_id', NEW.id, 'pv_numero', NEW.numero));
    PERFORM public._chantier_audit(NEW.company_id, NEW.owner_id, NEW.chantier_id,
      'chantier.closed_from_pv', jsonb_build_object('pv_id', NEW.id, 'pv_numero', NEW.numero));
  ELSE
    -- PV signé avec réserves OU réserves ouvertes ailleurs → marque réceptionné, attend levée
    UPDATE public.chantiers
       SET status = CASE WHEN status IN ('termine','archive') THEN status ELSE 'receptionne' END,
           received_at = COALESCE(received_at, NEW.signed_at, now()),
           updated_at = now()
     WHERE id = NEW.chantier_id AND status NOT IN ('termine','archive');
    PERFORM public._chantier_audit(NEW.company_id, NEW.owner_id, NEW.chantier_id,
      'chantier.received_from_pv',
      jsonb_build_object(
        'pv_id', NEW.id,
        'with_reserves', COALESCE(NEW.reception_with_reserves, false),
        'open_reserves_other_pv', v_open_other
      ));
  END IF;
  RETURN NEW;
END
$function$;
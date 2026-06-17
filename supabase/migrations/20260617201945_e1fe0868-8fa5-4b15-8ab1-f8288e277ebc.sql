
DO $$
DECLARE _cid uuid := 'd6b7b3e7-dadb-42b4-98be-19bf02debae3';
BEGIN
  ALTER TABLE public.pv DISABLE TRIGGER USER;
  ALTER TABLE public.pv_reserves DISABLE TRIGGER USER;
  ALTER TABLE public.pv_photos DISABLE TRIGGER USER;
  ALTER TABLE public.pv_documents DISABLE TRIGGER USER;
  ALTER TABLE public.reserve_lift_reports DISABLE TRIGGER USER;
  ALTER TABLE public.reserve_lift_items DISABLE TRIGGER USER;
  ALTER TABLE public.reserve_lift_item_photos DISABLE TRIGGER USER;

  DELETE FROM public.reserve_lift_item_photos WHERE company_id=_cid;
  DELETE FROM public.reserve_lift_items WHERE report_id IN (SELECT id FROM public.reserve_lift_reports WHERE company_id=_cid);
  DELETE FROM public.reserve_lift_reports WHERE company_id=_cid;

  DELETE FROM public.pv_reserves WHERE company_id=_cid;
  DELETE FROM public.pv_photos WHERE pv_id IN (SELECT id FROM public.pv WHERE company_id=_cid);
  DELETE FROM public.pv_documents WHERE pv_id IN (SELECT id FROM public.pv WHERE company_id=_cid);
  DELETE FROM public.pv_signature_otps WHERE company_id=_cid;

  DELETE FROM public.chantier_events WHERE company_id=_cid AND (source_reserve_id IS NOT NULL OR event_type IN ('system_pv_created','system_pv_signed','system_reserve_created','system_reserve_lifted','levee_reserves','reception','cloture','sav','controle_qualite'));

  DELETE FROM public.pv WHERE company_id=_cid;

  UPDATE public.company_settings SET pv_number_next=1, updated_at=now() WHERE company_id=_cid;

  ALTER TABLE public.pv ENABLE TRIGGER USER;
  ALTER TABLE public.pv_reserves ENABLE TRIGGER USER;
  ALTER TABLE public.pv_photos ENABLE TRIGGER USER;
  ALTER TABLE public.pv_documents ENABLE TRIGGER USER;
  ALTER TABLE public.reserve_lift_reports ENABLE TRIGGER USER;
  ALTER TABLE public.reserve_lift_items ENABLE TRIGGER USER;
  ALTER TABLE public.reserve_lift_item_photos ENABLE TRIGGER USER;
END $$;

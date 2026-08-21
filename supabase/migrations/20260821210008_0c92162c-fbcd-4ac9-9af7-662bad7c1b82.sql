DO $$
DECLARE cid uuid := 'd6b7b3e7-dadb-42b4-98be-19bf02debae3';
        oid uuid := 'a6a5bca3-7c1a-429e-bef6-dd37afdd7d0a';
        beta uuid; gamma uuid; longch uuid; i int;
BEGIN
  INSERT INTO public.clients (owner_id, company_id, name, client_type)
  VALUES (oid, cid, 'ZZSEARCH Client Gamma', 'particulier') RETURNING id INTO gamma;
  INSERT INTO public.clients (owner_id, company_id, name, client_type)
  VALUES (oid, cid, 'ZZFILTER Client au nom extremement long pour tester la troncature des selects sur mobile', 'particulier');

  INSERT INTO public.chantiers (owner_id, company_id, name, status)
  VALUES (oid, cid, 'ZZSEARCH Chantier Beta', 'en_cours') RETURNING id INTO beta;
  INSERT INTO public.chantiers (owner_id, company_id, name, status)
  VALUES (oid, cid, 'ZZFILTER Chantier au nom vraiment tres long pour verifier la troncature du trigger et des items', 'en_cours') RETURNING id INTO longch;
  FOR i IN 1..20 LOOP
    INSERT INTO public.chantiers (owner_id, company_id, name, status)
    VALUES (oid, cid, 'ZZFILTER Chantier ' || lpad(i::text, 2, '0'), 'en_cours');
  END LOOP;

  INSERT INTO public.chantier_events (company_id, chantier_id, client_id, title, event_type, status, start_at, end_at, all_day, assigned_to, location, color_source)
  VALUES
    (cid, beta, NULL, 'ZZSEARCH Installation Alpha', 'installation', 'prevu', '2026-08-21T09:00:00Z', '2026-08-21T10:00:00Z', false, NULL, NULL, 'auto'),
    (cid, beta, NULL, 'ZZEVT sur chantier Beta', 'intervention', 'prevu', '2026-08-21T11:00:00Z', '2026-08-21T12:00:00Z', false, NULL, NULL, 'auto'),
    (cid, longch, gamma, 'ZZEVT pour client Gamma', 'intervention', 'prevu', '2026-08-21T13:00:00Z', '2026-08-21T14:00:00Z', false, NULL, NULL, 'auto'),
    (cid, longch, NULL, 'ZZEVT avec lieu', 'pose', 'termine', '2026-08-21T15:00:00Z', '2026-08-21T16:00:00Z', false, NULL, 'ZZSEARCH Toulon Delta', 'auto'),
    (cid, beta, NULL, 'ZZEVT assigne technicien', 'visite_technique', 'annule', '2026-08-21T17:00:00Z', '2026-08-21T18:00:00Z', false, oid, NULL, 'auto');
END $$;
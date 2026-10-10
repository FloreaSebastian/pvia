-- Garde 0012 (invitations, gouvernance des adhésions, RLS membres).
-- Exécution : un seul bloc DO qui lève TOUJOURS une exception finale
-- => toute la transaction (fixtures comprises) est annulée.
-- Aucune insertion dans auth.users, aucun email/push (triggers de notification
-- annulés avec la transaction).
DO $$
DECLARE
  c uuid := gen_random_uuid();
  c2 uuid := gen_random_uuid();
  u_dir uuid := gen_random_uuid();
  u_adm uuid := gen_random_uuid();
  u_tech uuid := gen_random_uuid();
  m_dir uuid; m_tech uuid;
  n int; ok int := 0; failed text := '';
  fut timestamptz := now() + interval '1 day';
  past timestamptz := now() - interval '1 minute';
BEGIN
  -- 1. Prédicat destinataire (miroir de inviteUsableFor côté serveur)
  IF public.invite_recipient_matches('bob@ex.fr','invited',NULL,fut,' BOB@ex.fr ') THEN ok := ok+1; ELSE failed := failed||' P1'; END IF;
  IF NOT public.invite_recipient_matches('bob@ex.fr','invited',NULL,fut,'eve@ex.fr') THEN ok := ok+1; ELSE failed := failed||' P2'; END IF;
  IF NOT public.invite_recipient_matches('bob@ex.fr','invited',NULL,past,'bob@ex.fr') THEN ok := ok+1; ELSE failed := failed||' P3'; END IF;
  IF NOT public.invite_recipient_matches('bob@ex.fr','invited',NULL,NULL,'bob@ex.fr') THEN ok := ok+1; ELSE failed := failed||' P4'; END IF;
  IF NOT public.invite_recipient_matches('bob@ex.fr','active',NULL,fut,'bob@ex.fr') THEN ok := ok+1; ELSE failed := failed||' P5'; END IF;
  IF NOT public.invite_recipient_matches('bob@ex.fr','suspended',NULL,fut,'bob@ex.fr') THEN ok := ok+1; ELSE failed := failed||' P6'; END IF;
  IF NOT public.invite_recipient_matches('bob@ex.fr','invited',gen_random_uuid(),fut,'bob@ex.fr') THEN ok := ok+1; ELSE failed := failed||' P7'; END IF;
  IF NOT public.invite_recipient_matches(NULL,'invited',NULL,fut,'') THEN ok := ok+1; ELSE failed := failed||' P8'; END IF;

  -- 2. handle_new_user installé : plus aucune activation sans prédicat ni email vérifié
  IF position('invite_recipient_matches' in pg_get_functiondef('public.handle_new_user()'::regprocedure)) > 0
     AND position('email_confirmed_at is not null' in pg_get_functiondef('public.handle_new_user()'::regprocedure)) > 0
  THEN ok := ok+1; ELSE failed := failed||' H1'; END IF;

  -- Fixtures (annulées)
  INSERT INTO public.companies(id, name, email) VALUES (c, 'ZZ test 0012', 'zz@test.invalid'), (c2, 'ZZ test 0012 b', 'zz2@test.invalid');
  INSERT INTO public.company_members(company_id,user_id,role,status) VALUES (c,u_dir,'directeur','active') RETURNING id INTO m_dir;
  INSERT INTO public.company_members(company_id,user_id,role,status) VALUES (c,u_adm,'responsable_exploitation','active');
  INSERT INTO public.company_members(company_id,user_id,role,status) VALUES (c,u_tech,'technicien','active') RETURNING id INTO m_tech;

  -- 3. Gouvernance : company_id immuable côté client
  PERFORM set_config('request.jwt.claims', json_build_object('sub',u_adm,'role','authenticated')::text, true);
  BEGIN
    UPDATE public.company_members SET company_id = c2 WHERE id = m_tech;
    failed := failed||' G1';
  EXCEPTION WHEN insufficient_privilege THEN ok := ok+1; END;

  -- 4. Non-directeur ne peut pas modifier un Directeur
  BEGIN
    UPDATE public.company_members SET status = 'suspended' WHERE id = m_dir;
    failed := failed||' G2';
  EXCEPTION WHEN insufficient_privilege THEN ok := ok+1; END;

  -- 5. Dernier Directeur actif protégé (compté sur OLD.company_id)
  PERFORM set_config('request.jwt.claims', json_build_object('sub',u_dir,'role','authenticated')::text, true);
  BEGIN
    DELETE FROM public.company_members WHERE id = m_dir;
    failed := failed||' G3';
  EXCEPTION WHEN check_violation THEN ok := ok+1; END;

  -- 6. Pas de nouvelle attribution Directeur par un non-directeur
  PERFORM set_config('request.jwt.claims', json_build_object('sub',u_adm,'role','authenticated')::text, true);
  BEGIN
    UPDATE public.company_members SET role = 'directeur' WHERE id = m_tech;
    failed := failed||' G4';
  EXCEPTION WHEN insufficient_privilege THEN ok := ok+1; END;

  -- 7. RLS : mutation client refusée tant que l'écriture n'est pas ouverte
  UPDATE public.companies SET trial_ends_at = now() - interval '1 day' WHERE id = c;
  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE public.company_members SET status = 'suspended' WHERE id = m_tech;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN ok := ok+1; ELSE failed := failed||' R1'; END IF;
  DELETE FROM public.company_members WHERE id = m_tech;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN ok := ok+1; ELSE failed := failed||' R2'; END IF;
  EXECUTE 'RESET ROLE';

  -- 8. Écriture ouverte : l'administrateur actif peut suspendre un technicien
  UPDATE public.companies SET trial_ends_at = now() + interval '5 days' WHERE id = c;
  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE public.company_members SET status = 'suspended' WHERE id = m_tech;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 1 THEN ok := ok+1; ELSE failed := failed||' R3'; END IF;
  EXECUTE 'RESET ROLE';

  RAISE EXCEPTION 'TEST_ROLLBACK ok=% failed=[%]', ok, failed;
END $$;

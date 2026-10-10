-- Garde-fous équipe/invitations (migrations 0012 + 0013).
-- Exécution : psql -v ON_ERROR_STOP=1 -f tests/db/team-invite-guards.rollback.sql
-- Tout se déroule dans UNE transaction explicitement annulée (ROLLBACK) :
-- aucune ligne ne subsiste. Aucun auth.users créé, aucun email ni push.
-- Le bloc DO ne lève une exception QUE si une assertion échoue ; sinon il
-- publie un rapport (NOTICE) et la transaction est annulée.
-- Limite : H1/H2 inspectent la DÉFINITION installée de handle_new_user ; ils
-- ne prouvent pas le comportement d'une vraie inscription.
BEGIN;

DO $$
DECLARE
  c uuid := gen_random_uuid(); c2 uuid := gen_random_uuid(); c3 uuid := gen_random_uuid();
  u_dir uuid := gen_random_uuid(); u_adm uuid := gen_random_uuid(); u_tech uuid := gen_random_uuid();
  m_dir uuid; m_tech uuid; inv1 uuid; inv2 uuid; n int; ok int := 0; failed text := '';
  renewed int := 0; quota_refused int := 0; def text;
  fut timestamptz := now() + interval '1 day'; past timestamptz := now() - interval '1 minute';
BEGIN
  -- Prédicat invite_recipient_matches (destinataire exact, statut, user NULL, expiration)
  IF public.invite_recipient_matches('bob@ex.fr','invited',NULL,fut,' BOB@ex.fr ') THEN ok := ok+1; ELSE failed := failed||' P1'; END IF;
  IF NOT public.invite_recipient_matches('bob@ex.fr','invited',NULL,fut,'eve@ex.fr') THEN ok := ok+1; ELSE failed := failed||' P2'; END IF;
  IF NOT public.invite_recipient_matches('bob@ex.fr','invited',NULL,past,'bob@ex.fr') THEN ok := ok+1; ELSE failed := failed||' P3'; END IF;
  IF NOT public.invite_recipient_matches('bob@ex.fr','invited',NULL,NULL,'bob@ex.fr') THEN ok := ok+1; ELSE failed := failed||' P4'; END IF;
  IF NOT public.invite_recipient_matches('bob@ex.fr','active',NULL,fut,'bob@ex.fr') THEN ok := ok+1; ELSE failed := failed||' P5'; END IF;
  IF NOT public.invite_recipient_matches('bob@ex.fr','suspended',NULL,fut,'bob@ex.fr') THEN ok := ok+1; ELSE failed := failed||' P6'; END IF;
  IF NOT public.invite_recipient_matches('bob@ex.fr','invited',gen_random_uuid(),fut,'bob@ex.fr') THEN ok := ok+1; ELSE failed := failed||' P7'; END IF;
  IF NOT public.invite_recipient_matches(NULL,'invited',NULL,fut,'') THEN ok := ok+1; ELSE failed := failed||' P8'; END IF;

  -- Définition installée (0013) : l'inscription n'active jamais d'invitation.
  def := lower(pg_get_functiondef('public.handle_new_user()'::regprocedure));
  IF position('invite_recipient_matches' in def) > 0
     AND position('pending_invitation' in def) > 0 THEN ok := ok+1; ELSE failed := failed||' H1'; END IF;
  IF position('update public.company_members' in def) = 0
     AND position('email_confirmed_at' in def) = 0 THEN ok := ok+1; ELSE failed := failed||' H2'; END IF;

  -- Fixtures : formule fictive 20 sièges, écriture fermée (résiliée, sans fin programmée).
  INSERT INTO public.companies(id, name, email) VALUES
    (c, 'ZZ test 0012', 'zz@test.invalid'), (c2, 'ZZ test 0012 b', 'zz2@test.invalid'),
    (c3, 'ZZ test 0012 quota', 'zz3@test.invalid');
  UPDATE public.companies SET trial_ends_at = now() - interval '1 day' WHERE id IN (c, c3);
  INSERT INTO public.subscriptions(company_id,user_id,stripe_customer_id,stripe_subscription_id,plan,status,current_period_end,cancel_at_period_end)
    VALUES (c,u_dir,'cus_zz_test','sub_zz_test_'||c,'business','canceled',now()+interval '10 days',false);
  INSERT INTO public.company_members(company_id,user_id,role,status) VALUES (c,u_dir,'directeur','active') RETURNING id INTO m_dir;
  INSERT INTO public.company_members(company_id,user_id,role,status) VALUES (c,u_adm,'responsable_exploitation','active');
  INSERT INTO public.company_members(company_id,user_id,role,status) VALUES (c,u_tech,'technicien','active') RETURNING id INTO m_tech;

  -- Gouvernance (0012)
  PERFORM set_config('request.jwt.claims', json_build_object('sub',u_adm,'role','authenticated')::text, true);
  BEGIN UPDATE public.company_members SET company_id = c2 WHERE id = m_tech; failed := failed||' G1';
  EXCEPTION WHEN insufficient_privilege THEN ok := ok+1; END;
  BEGIN UPDATE public.company_members SET status = 'suspended' WHERE id = m_dir; failed := failed||' G2';
  EXCEPTION WHEN insufficient_privilege THEN ok := ok+1; END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',u_dir,'role','authenticated')::text, true);
  BEGIN DELETE FROM public.company_members WHERE id = m_dir; failed := failed||' G3';
  EXCEPTION WHEN check_violation THEN ok := ok+1; END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',u_adm,'role','authenticated')::text, true);
  BEGIN UPDATE public.company_members SET role = 'directeur' WHERE id = m_tech; failed := failed||' G4';
  EXCEPTION WHEN insufficient_privilege THEN ok := ok+1; END;

  -- RLS : mutations client fermées sans accès écriture, ouvertes avec (0012)
  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE public.company_members SET status = 'suspended' WHERE id = m_tech;
  GET DIAGNOSTICS n = ROW_COUNT; IF n = 0 THEN ok := ok+1; ELSE failed := failed||' R1'; END IF;
  DELETE FROM public.company_members WHERE id = m_tech;
  GET DIAGNOSTICS n = ROW_COUNT; IF n = 0 THEN ok := ok+1; ELSE failed := failed||' R2'; END IF;
  EXECUTE 'RESET ROLE';
  UPDATE public.subscriptions SET cancel_at_period_end = true WHERE company_id = c;
  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE public.company_members SET status = 'suspended' WHERE id = m_tech;
  GET DIAGNOSTICS n = ROW_COUNT; IF n = 1 THEN ok := ok+1; ELSE failed := failed||' R3'; END IF;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);

  -- Quota au renouvellement : formule pro (5 sièges), 4 occupés, 2 invitations expirées.
  INSERT INTO public.subscriptions(company_id,user_id,stripe_customer_id,stripe_subscription_id,plan,status,current_period_end,cancel_at_period_end)
    VALUES (c3,u_dir,'cus_zz_test','sub_zz_test_'||c3,'pro','active',now()+interval '10 days',false);
  INSERT INTO public.company_members(company_id,user_id,role,status) VALUES (c3,u_dir,'directeur','active');
  INSERT INTO public.company_members(company_id,user_id,role,status) VALUES (c3,u_adm,'technicien','active');
  INSERT INTO public.company_members(company_id,user_id,role,status) VALUES (c3,u_tech,'technicien','active');
  INSERT INTO public.company_members(company_id,invited_email,role,status,invite_token_hash,invite_expires_at)
    VALUES (c3,'q1@test.invalid','technicien','invited','h_old_1',fut) RETURNING id INTO inv1;
  INSERT INTO public.company_members(company_id,invited_email,role,status,invite_token_hash,invite_expires_at)
    VALUES (c3,'q2@test.invalid','technicien','invited','h_old_2',fut) RETURNING id INTO inv2;
  UPDATE public.company_members SET invite_expires_at = past WHERE id IN (inv1, inv2);
  INSERT INTO public.company_members(company_id,user_id,role,status) VALUES (c3,gen_random_uuid(),'technicien','active');
  IF public.get_company_seat_usage(c3) = 4 THEN ok := ok+1; ELSE failed := failed||' Q0'; END IF;

  -- Même UPDATE que casRotateInvite (id, entreprise, invited, user NULL, ancien hash ; status réécrit).
  BEGIN
    UPDATE public.company_members SET status='invited', invite_token_hash='h_new_1', invite_expires_at=fut
     WHERE id=inv1 AND company_id=c3 AND status='invited' AND user_id IS NULL AND invite_token_hash='h_old_1';
    GET DIAGNOSTICS n = ROW_COUNT; renewed := renewed + n;
  EXCEPTION WHEN check_violation THEN quota_refused := quota_refused + 1; END;
  BEGIN
    UPDATE public.company_members SET status='invited', invite_token_hash='h_new_2', invite_expires_at=fut
     WHERE id=inv2 AND company_id=c3 AND status='invited' AND user_id IS NULL AND invite_token_hash='h_old_2';
    GET DIAGNOSTICS n = ROW_COUNT; renewed := renewed + n;
  EXCEPTION WHEN check_violation THEN quota_refused := quota_refused + 1; END;
  IF renewed = 1 AND quota_refused = 1 THEN ok := ok+1; ELSE failed := failed||' Q1('||renewed||'/'||quota_refused||')'; END IF;
  IF (SELECT invite_token_hash FROM public.company_members WHERE id=inv2) = 'h_old_2' THEN ok := ok+1; ELSE failed := failed||' Q2'; END IF;
  -- Ancien hash : le CAS ne touche plus la ligne renouvelée.
  UPDATE public.company_members SET status='invited', invite_token_hash='h_x'
   WHERE id=inv1 AND status='invited' AND user_id IS NULL AND invite_token_hash='h_old_1';
  GET DIAGNOSTICS n = ROW_COUNT; IF n = 0 THEN ok := ok+1; ELSE failed := failed||' Q3'; END IF;

  IF failed <> '' THEN
    RAISE EXCEPTION 'ÉCHEC assertions [%] (réussies : %)', failed, ok;
  END IF;
  RAISE NOTICE 'OK : % / 21 assertions réussies (transaction annulée ensuite)', ok;
END $$;

ROLLBACK;

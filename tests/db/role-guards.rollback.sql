-- Test comportemental des règles d'accès (migrations 0009/0010/0011) contre les règles installées.
-- Exécution fichier : psql -v ON_ERROR_STOP=1 -f tests/db/role-guards.rollback.sql
--   BEGIN explicite, aucune instruction COMMIT ; toute assertion en échec lève une
--   erreur (psql s'arrête, la transaction ouverte n'est jamais validée) ; sinon ROLLBACK final.
-- Les identifiants utilisateurs existants ne servent que de valeurs UUID (FK) ; leurs comptes ne sont pas modifiés.
-- Nécessite un rôle capable de SET ROLE authenticated (sinon exécuter le corps via l'outil SQL du projet,
-- terminé par une exception volontaire qui annule tout).
\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.try(_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE n int;
BEGIN
  EXECUTE _sql; GET DIAGNOSTICS n = ROW_COUNT; RETURN 'rows=' || n;
EXCEPTION WHEN others THEN RETURN 'ERR:' || SQLERRM;
END $f$;
GRANT EXECUTE ON FUNCTION pg_temp.try(text) TO authenticated;
CREATE FUNCTION pg_temp.as_user(_uid uuid, _role text) RETURNS void LANGUAGE sql AS $f$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', _role)::text, true);
$f$;
GRANT EXECUTE ON FUNCTION pg_temp.as_user(uuid, text) TO authenticated;
CREATE TEMP TABLE r(k text, v text);
GRANT ALL ON r TO authenticated;
SELECT count(*) FROM (SELECT set_config('rb.owner', (SELECT id::text FROM public.profiles ORDER BY created_at LIMIT 1), true)) x;
SELECT count(*) FROM (SELECT set_config('rb.u' || n, id::text, true) FROM (SELECT id, row_number() OVER () AS n FROM (SELECT id FROM public.profiles ORDER BY created_at LIMIT 4) d) t) x;
INSERT INTO companies (id, name, trial_ends_at) VALUES
  ('00000000-0000-4000-8000-00000000c001','RB A', now() + interval '10 days'),
  ('00000000-0000-4000-8000-00000000c002','RB B', now() + interval '10 days');
INSERT INTO subscriptions (company_id, user_id, stripe_customer_id, stripe_subscription_id, plan, status, current_period_end) VALUES
  ('00000000-0000-4000-8000-00000000c001', current_setting('rb.owner')::uuid, 'cus_rollback_fixture', 'sub_rollback_fixture', 'business', 'active', now() + interval '20 days');
INSERT INTO company_members (company_id, user_id, role, status) VALUES
  ('00000000-0000-4000-8000-00000000c001',current_setting('rb.u1')::uuid,'assistant_admin','active'),
  ('00000000-0000-4000-8000-00000000c001',current_setting('rb.u2')::uuid,'conducteur_travaux','active'),
  ('00000000-0000-4000-8000-00000000c001',current_setting('rb.u3')::uuid,'technicien','active'),
  ('00000000-0000-4000-8000-00000000c001',current_setting('rb.u4')::uuid,'lecture_seule','active');
INSERT INTO clients (id, owner_id, company_id, name) VALUES
  ('00000000-0000-4000-8000-0000000c1a01',current_setting('rb.owner')::uuid,'00000000-0000-4000-8000-00000000c001','Client A'),
  ('00000000-0000-4000-8000-0000000c1b01',current_setting('rb.owner')::uuid,'00000000-0000-4000-8000-00000000c002','Client B');
INSERT INTO chantiers (id, owner_id, company_id, name, reference) VALUES
  ('00000000-0000-4000-8000-00000000ca01',current_setting('rb.owner')::uuid,'00000000-0000-4000-8000-00000000c001','Chantier A','RB-A');
INSERT INTO technical_visits (id, company_id, chantier_id, visit_type, status, assigned_to, lots) VALUES
  ('00000000-0000-4000-8000-0000000000e1','00000000-0000-4000-8000-00000000c001','00000000-0000-4000-8000-00000000ca01','btp','en_cours',current_setting('rb.u3')::uuid, ARRAY['electricite']),
  ('00000000-0000-4000-8000-0000000000e2','00000000-0000-4000-8000-00000000c001','00000000-0000-4000-8000-00000000ca01','btp','en_cours',current_setting('rb.u4')::uuid, ARRAY['electricite']),
  ('00000000-0000-4000-8000-0000000000e3','00000000-0000-4000-8000-00000000c001','00000000-0000-4000-8000-00000000ca01','btp','validee',current_setting('rb.u3')::uuid, ARRAY['electricite']);
INSERT INTO pv (id, owner_id, company_id, numero, status) VALUES
  ('00000000-0000-4000-8000-0000000000b1',current_setting('rb.owner')::uuid,'00000000-0000-4000-8000-00000000c001','RB-PV-1','brouillon');
INSERT INTO pv_reserves (id, pv_id, owner_id, company_id, description, status) VALUES
  ('00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000b1',current_setting('rb.owner')::uuid,'00000000-0000-4000-8000-00000000c001','R','ouverte');
-- Entreprise B sans abonnement => offre starter, sans fonctionnalité visites.
INSERT INTO company_members (company_id, user_id, role, status) VALUES
  ('00000000-0000-4000-8000-00000000c002',current_setting('rb.u2')::uuid,'conducteur_travaux','active');
INSERT INTO chantiers (id, owner_id, company_id, name, reference) VALUES
  ('00000000-0000-4000-8000-00000000cb01',current_setting('rb.owner')::uuid,'00000000-0000-4000-8000-00000000c002','Chantier B','RB-B');
INSERT INTO technical_visits (id, company_id, chantier_id, visit_type, status, assigned_to, lots) VALUES
  ('00000000-0000-4000-8000-0000000000f1','00000000-0000-4000-8000-00000000c002','00000000-0000-4000-8000-00000000cb01','btp','en_cours',current_setting('rb.u2')::uuid, ARRAY['electricite']);
INSERT INTO pv (id, owner_id, company_id, numero, status) VALUES
  ('00000000-0000-4000-8000-0000000000b2',current_setting('rb.owner')::uuid,'00000000-0000-4000-8000-00000000c001','RB-PV-2','archive'),
  ('00000000-0000-4000-8000-0000000000b3',current_setting('rb.owner')::uuid,'00000000-0000-4000-8000-00000000c001','RB-PV-3','en_attente');
INSERT INTO pv (id, owner_id, company_id, numero, status, signed_at, locked_at, company_signature, client_signature) VALUES
  ('00000000-0000-4000-8000-0000000000b4',current_setting('rb.owner')::uuid,'00000000-0000-4000-8000-00000000c001','RB-PV-4','signe', now(), now(), 'data:c', 'data:k');
SET LOCAL ROLE authenticated;
INSERT INTO r VALUES
 ('t01', public.can_edit_technical_visit('00000000-0000-4000-8000-0000000000e1',current_setting('rb.u3')::uuid)::text),
 ('t02', public.can_edit_technical_visit('00000000-0000-4000-8000-0000000000e2',current_setting('rb.u4')::uuid)::text),
 ('t03', public.can_edit_technical_visit('00000000-0000-4000-8000-0000000000e3',current_setting('rb.u3')::uuid)::text),
 ('t04', public.can_write_company_member('00000000-0000-4000-8000-00000000c001',current_setting('rb.u4')::uuid)::text),
 ('t05', public.can_write_company_member('00000000-0000-4000-8000-00000000c001',current_setting('rb.u3')::uuid)::text);
SELECT pg_temp.as_user(current_setting('rb.u3')::uuid,'authenticated');
INSERT INTO r VALUES
 ('t06', pg_temp.try($q$UPDATE technical_visits SET prep_notes='terrain' WHERE id='00000000-0000-4000-8000-0000000000e1'$q$)),
 ('t07', pg_temp.try($q$UPDATE technical_visits SET status='terminee' WHERE id='00000000-0000-4000-8000-0000000000e1'$q$)),
 ('t08', pg_temp.try($q$UPDATE technical_visits SET scheduled_at=now() WHERE id='00000000-0000-4000-8000-0000000000e1'$q$)),
 ('t09', pg_temp.try($q$UPDATE technical_visits SET assigned_to=null WHERE id='00000000-0000-4000-8000-0000000000e1'$q$)),
 ('t10', pg_temp.try($q$UPDATE technical_visits SET status='validee' WHERE id='00000000-0000-4000-8000-0000000000e1'$q$)),
 ('t11', pg_temp.try($q$UPDATE technical_visits SET prep_notes='x' WHERE id='00000000-0000-4000-8000-0000000000e3'$q$)),
 ('t12', pg_temp.try($q$INSERT INTO pv (owner_id, company_id, numero, status) VALUES (current_setting('rb.owner')::uuid,'00000000-0000-4000-8000-00000000c001','RB-T','brouillon')$q$)),
 ('t15', pg_temp.try($q$INSERT INTO pv_photos (pv_id, company_id, owner_id, url) VALUES ('00000000-0000-4000-8000-0000000000b1','00000000-0000-4000-8000-00000000c001',current_setting('rb.u3')::uuid,'00000000-0000-4000-8000-00000000c001/t.jpg')$q$));
SELECT pg_temp.as_user(current_setting('rb.u4')::uuid,'authenticated');
INSERT INTO r VALUES
 ('t13', pg_temp.try($q$UPDATE technical_visits SET prep_notes='x' WHERE id='00000000-0000-4000-8000-0000000000e2'$q$)),
 ('t14', pg_temp.try($q$INSERT INTO pv_photos (pv_id, company_id, owner_id, url) VALUES ('00000000-0000-4000-8000-0000000000b1','00000000-0000-4000-8000-00000000c001',current_setting('rb.u4')::uuid,'00000000-0000-4000-8000-00000000c001/l.jpg')$q$));
SELECT pg_temp.as_user(current_setting('rb.u1')::uuid,'authenticated');
INSERT INTO r VALUES
 ('t16', pg_temp.try($q$INSERT INTO pv (owner_id, company_id, numero, status, client_id) VALUES (current_setting('rb.owner')::uuid,'00000000-0000-4000-8000-00000000c001','RB-A1','brouillon','00000000-0000-4000-8000-0000000c1a01')$q$)),
 ('t17', pg_temp.try($q$INSERT INTO pv (owner_id, company_id, numero, status) VALUES (current_setting('rb.owner')::uuid,'00000000-0000-4000-8000-00000000c001','RB-A2','signe')$q$)),
 ('t18', pg_temp.try($q$UPDATE pv SET company_signature='data:x' WHERE id='00000000-0000-4000-8000-0000000000b1'$q$)),
 ('t19', pg_temp.try($q$INSERT INTO pv (owner_id, company_id, numero, status, client_id) VALUES (current_setting('rb.owner')::uuid,'00000000-0000-4000-8000-00000000c001','RB-A3','brouillon','00000000-0000-4000-8000-0000000c1b01')$q$)),
 ('t20', pg_temp.try($q$UPDATE pv_reserves SET status='validee' WHERE id='00000000-0000-4000-8000-0000000000d1'$q$)),
 ('t21', pg_temp.try($q$INSERT INTO reserve_lift_reports (pv_id, company_id, numero) VALUES ('00000000-0000-4000-8000-0000000000b1','00000000-0000-4000-8000-00000000c001','RB-L1')$q$));
SELECT pg_temp.as_user(current_setting('rb.u2')::uuid,'authenticated');
INSERT INTO r VALUES
 ('t22', pg_temp.try($q$UPDATE pv SET company_signature='data:x' WHERE id='00000000-0000-4000-8000-0000000000b1'$q$)),
 ('t23', pg_temp.try($q$UPDATE pv_reserves SET status='levee' WHERE id='00000000-0000-4000-8000-0000000000d1'$q$)),
 ('t24', pg_temp.try($q$INSERT INTO reserve_lift_reports (pv_id, company_id, numero) VALUES ('00000000-0000-4000-8000-0000000000b1','00000000-0000-4000-8000-00000000c001','RB-L2')$q$));
-- Fonctionnalité visites absente (entreprise B, starter) : lecture conservée, écriture refusée.
SELECT pg_temp.as_user(current_setting('rb.u2')::uuid,'authenticated');
INSERT INTO r VALUES
 ('t26', public.can_edit_technical_visit('00000000-0000-4000-8000-0000000000f1',current_setting('rb.u2')::uuid)::text),
 ('t27', pg_temp.try($q$UPDATE technical_visits SET prep_notes='x' WHERE id='00000000-0000-4000-8000-0000000000f1'$q$)),
 ('t28', pg_temp.try($q$INSERT INTO technical_visits (company_id, chantier_id, visit_type, status, lots) VALUES ('00000000-0000-4000-8000-00000000c002','00000000-0000-4000-8000-00000000cb01','btp','a_planifier',ARRAY['electricite'])$q$)),
 ('t29', (SELECT count(*)::text FROM technical_visits WHERE id='00000000-0000-4000-8000-0000000000f1')),
 ('t36', pg_temp.try($q$UPDATE pv SET status='archive' WHERE id='00000000-0000-4000-8000-0000000000b3'$q$)),
 ('t38', pg_temp.try($q$UPDATE pv SET consent_at=now() WHERE id='00000000-0000-4000-8000-0000000000b1'$q$)),
 ('t39', pg_temp.try($q$UPDATE pv SET sent_to_email='x@example.invalid' WHERE id='00000000-0000-4000-8000-0000000000b4'$q$));
-- Assistant : statuts et preuves
SELECT pg_temp.as_user(current_setting('rb.u1')::uuid,'authenticated');
INSERT INTO r VALUES
 ('t30', pg_temp.try($q$UPDATE pv SET status='archive' WHERE id='00000000-0000-4000-8000-0000000000b1'$q$)),
 ('t31', pg_temp.try($q$UPDATE pv SET status='brouillon' WHERE id='00000000-0000-4000-8000-0000000000b2'$q$)),
 ('t32', pg_temp.try($q$UPDATE pv SET observations='note' WHERE id='00000000-0000-4000-8000-0000000000b3'$q$)),
 ('t33', pg_temp.try($q$UPDATE pv SET signature_mode='remote' WHERE id='00000000-0000-4000-8000-0000000000b1'$q$)),
 ('t34', pg_temp.try($q$UPDATE pv SET client_otp_verified=true WHERE id='00000000-0000-4000-8000-0000000000b1'$q$)),
 ('t35', pg_temp.try($q$INSERT INTO pv (owner_id, company_id, numero, status, consent_text) VALUES (current_setting('rb.owner')::uuid,'00000000-0000-4000-8000-00000000c001','RB-A9','brouillon','faux')$q$));
RESET ROLE;
SELECT pg_temp.as_user(current_setting('rb.u1')::uuid,'service_role');
INSERT INTO r VALUES ('t37', pg_temp.try($q$UPDATE pv SET client_otp_verified=true WHERE id='00000000-0000-4000-8000-0000000000b1'$q$));
INSERT INTO r VALUES ('t25', pg_temp.try($q$UPDATE pv_reserves SET status='validee' WHERE id='00000000-0000-4000-8000-0000000000d1'$q$));
CREATE TEMP TABLE expected(k text, v text);
INSERT INTO expected VALUES
 ('t01', $e$true$e$),
 ('t02', $e$false$e$),
 ('t03', $e$false$e$),
 ('t04', $e$false$e$),
 ('t05', $e$true$e$),
 ('t06', $e$rows=1$e$),
 ('t07', $e$rows=1$e$),
 ('t08', $e$ERR:VT_FIELD_MANAGER_ONLY$e$),
 ('t09', $e$ERR:VT_FIELD_MANAGER_ONLY$e$),
 ('t10', $e$ERR:VT_STATUS_MANAGER_ONLY$e$),
 ('t11', $e$rows=0$e$),
 ('t12', $e$ERR:new row violates row-level security policy for table "pv"$e$),
 ('t13', $e$rows=0$e$),
 ('t14', $e$ERR:new row violates row-level security policy for table "pv_photos"$e$),
 ('t15', $e$rows=1$e$),
 ('t16', $e$rows=1$e$),
 ('t17', $e$ERR:PV_SIGN_ROLE_REQUIRED$e$),
 ('t18', $e$ERR:PV_SIGN_ROLE_REQUIRED$e$),
 ('t19', $e$ERR:PV_PARENT_TENANT$e$),
 ('t20', $e$ERR:RESERVE_SIGN_ROLE_REQUIRED$e$),
 ('t21', $e$ERR:LIFT_SIGN_ROLE_REQUIRED$e$),
 ('t22', $e$rows=1$e$),
 ('t23', $e$rows=1$e$),
 ('t24', $e$rows=1$e$),
 ('t25', $e$rows=1$e$),
 ('t26', $e$false$e$),
 ('t27', $e$rows=0$e$),
 ('t28', $e$ERR:new row violates row-level security policy for table "technical_visits"$e$),
 ('t29', $e$1$e$),
 ('t30', $e$ERR:PV_SIGN_ROLE_REQUIRED$e$),
 ('t31', $e$ERR:PV_SIGN_ROLE_REQUIRED$e$),
 ('t32', $e$rows=1$e$),
 ('t33', $e$rows=1$e$),
 ('t34', $e$ERR:PV_PROOF_SERVER_ONLY$e$),
 ('t35', $e$ERR:PV_PROOF_SERVER_ONLY$e$),
 ('t36', $e$rows=1$e$),
 ('t37', $e$rows=1$e$),
 ('t38', $e$ERR:PV_PROOF_SERVER_ONLY$e$),
 ('t39', $e$ERR:PV_LOCKED_SIGNED$e$);
-- Assertion réelle : la moindre divergence lève une erreur (transaction annulée).
DO $a$
DECLARE _bad text;
BEGIN
  SELECT string_agg(e.k || ' attendu=' || e.v || ' obtenu=' || coalesce(r.v,'(absent)'), ' ; ' ORDER BY e.k)
    INTO _bad FROM expected e LEFT JOIN r USING (k) WHERE r.v IS DISTINCT FROM e.v;
  IF _bad IS NOT NULL THEN RAISE EXCEPTION 'RB_FAIL %', _bad; END IF;
END $a$;
SELECT 'RB_OK ' || count(*) || ' cas' FROM r;
ROLLBACK;

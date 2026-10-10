-- Test comportemental des règles d'accès (migrations 0009/0010) contre les règles réellement installées.
-- Une seule transaction qui se termine TOUJOURS par une exception : rien n'est validé ni conservé.
-- Les identifiants utilisateurs existants ne servent que de valeurs UUID (FK) ; leurs comptes ne sont pas modifiés.
-- Résultats attendus (clé = attendu) :
-- t01 technicien affecté peut éditer = true      t02 lecture seule affectée = false
-- t03 technicien sur visite validée = false       t04 écriture membre lecture seule = false
-- t05 écriture membre technicien = true           t06 saisie terrain technicien = rows=1
-- t07 technicien termine = rows=1                 t08 technicien change planning = ERR VT_FIELD_MANAGER_ONLY
-- t09 technicien réaffecte = ERR                  t10 technicien valide = ERR VT_STATUS_MANAGER_ONLY
-- t11 technicien visite figée = rows=0            t12 technicien crée PV = ERR RLS
-- t13 lecture seule modifie visite = rows=0       t14 lecture seule photo PV = ERR RLS
-- t15 technicien photo PV = rows=1                t16 assistant PV brouillon = rows=1
-- t17 assistant PV signé = ERR PV_SIGN_ROLE_REQUIRED
-- t18 assistant ajoute signature brouillon = ERR PV_SIGN_ROLE_REQUIRED
-- t19 assistant client autre entreprise = ERR PV_PARENT_TENANT
-- t20 assistant valide réserve = ERR RESERVE_SIGN_ROLE_REQUIRED
-- t21 assistant rapport de levée = ERR LIFT_SIGN_ROLE_REQUIRED
-- t22 conducteur signe = rows=1                   t23 conducteur lève réserve = rows=1
-- t24 conducteur rapport de levée = rows=1        t25 flux service_role validation = rows=1
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
RESET ROLE;
SELECT pg_temp.as_user(current_setting('rb.u1')::uuid,'service_role');
INSERT INTO r VALUES ('t25', pg_temp.try($q$UPDATE pv_reserves SET status='validee' WHERE id='00000000-0000-4000-8000-0000000000d1'$q$));
DO $d$ BEGIN RAISE EXCEPTION 'RB_RESULTS %', (SELECT string_agg(k || '=' || replace(replace(v, 'signature', 'sig'), 'SIGN', 'S'), ' ; ' ORDER BY k) FROM r); END $d$;

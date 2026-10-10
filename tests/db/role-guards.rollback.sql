-- Test comportemental des règles d'accès 0009/0010.
-- Exécuté dans UNE transaction qui se termine toujours par une exception : aucune donnée persistée.
BEGIN;
CREATE FUNCTION pg_temp.try(_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  EXECUTE _sql; GET DIAGNOSTICS n = ROW_COUNT; RETURN 'rows=' || n;
EXCEPTION WHEN others THEN RETURN 'ERR:' || SQLERRM;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.try(text) TO authenticated;
CREATE FUNCTION pg_temp.as_user(_uid uuid, _role text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', _role)::text, true);
$$;
GRANT EXECUTE ON FUNCTION pg_temp.as_user(uuid, text) TO authenticated;
CREATE TEMP TABLE r(k text, v text);
GRANT ALL ON r TO authenticated;

-- Fixtures éphémères
-- owner_id (FK auth.users) : réutilise un identifiant existant, jamais modifié (transaction annulée).
SELECT count(*) AS owner_ready FROM (SELECT set_config('rb.owner', (SELECT id::text FROM public.profiles ORDER BY created_at LIMIT 1), false)) x;
-- Identifiants utilisateurs existants réutilisés comme simples UUID (FK auth.users) :
-- leurs comptes ne sont pas modifiés et les adhésions fictives disparaissent au ROLLBACK.
SELECT count(*) AS users_ready FROM (
  SELECT set_config('rb.u' || n, id::text, false)
  FROM (SELECT user_id AS id, row_number() OVER () AS n
        FROM (SELECT id AS user_id FROM public.profiles ORDER BY created_at LIMIT 4) d) t) x;
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
-- Helpers (rôles réels)
INSERT INTO r VALUES
 ('edit_tech_assigned', public.can_edit_technical_visit('00000000-0000-4000-8000-0000000000e1',current_setting('rb.u3')::uuid)::text),
 ('edit_lecture_assigned', public.can_edit_technical_visit('00000000-0000-4000-8000-0000000000e2',current_setting('rb.u4')::uuid)::text),
 ('edit_tech_validee', public.can_edit_technical_visit('00000000-0000-4000-8000-0000000000e3',current_setting('rb.u3')::uuid)::text),
 ('member_write_lecture', public.can_write_company_member('00000000-0000-4000-8000-00000000c001',current_setting('rb.u4')::uuid)::text),
 ('member_write_tech', public.can_write_company_member('00000000-0000-4000-8000-00000000c001',current_setting('rb.u3')::uuid)::text);

-- Technicien affecté
SELECT pg_temp.as_user(current_setting('rb.u3')::uuid,'authenticated');
INSERT INTO r VALUES
 ('tech_prep_notes', pg_temp.try($$UPDATE technical_visits SET prep_notes='terrain' WHERE id='00000000-0000-4000-8000-0000000000e1'$$)),
 ('tech_terminee', pg_temp.try($$UPDATE technical_visits SET status='terminee' WHERE id='00000000-0000-4000-8000-0000000000e1'$$)),
 ('tech_planning', pg_temp.try($$UPDATE technical_visits SET scheduled_at=now() WHERE id='00000000-0000-4000-8000-0000000000e1'$$)),
 ('tech_reassign', pg_temp.try($$UPDATE technical_visits SET assigned_to=null WHERE id='00000000-0000-4000-8000-0000000000e1'$$)),
 ('tech_validee_status', pg_temp.try($$UPDATE technical_visits SET status='validee' WHERE id='00000000-0000-4000-8000-0000000000e1'$$)),
 ('tech_frozen_visit', pg_temp.try($$UPDATE technical_visits SET prep_notes='x' WHERE id='00000000-0000-4000-8000-0000000000e3'$$)),
 ('tech_pv_insert', pg_temp.try($$INSERT INTO pv (owner_id, company_id, numero, status) VALUES (current_setting('rb.owner')::uuid,'00000000-0000-4000-8000-00000000c001','RB-T','brouillon')$$));
-- Lecture seule affectée
SELECT pg_temp.as_user(current_setting('rb.u4')::uuid,'authenticated');
INSERT INTO r VALUES
 ('lecture_visit_update', pg_temp.try($$UPDATE technical_visits SET prep_notes='x' WHERE id='00000000-0000-4000-8000-0000000000e2'$$)),
 ('lecture_photo_insert', pg_temp.try($$INSERT INTO pv_photos (pv_id, company_id, owner_id, storage_path) VALUES ('00000000-0000-4000-8000-0000000000b1','00000000-0000-4000-8000-00000000c001',current_setting('rb.u4')::uuid,'00000000-0000-4000-8000-00000000c001/x.jpg')$$));
-- Assistant
SELECT pg_temp.as_user(current_setting('rb.u1')::uuid,'authenticated');
INSERT INTO r VALUES
 ('assistant_pv_draft', pg_temp.try($$INSERT INTO pv (owner_id, company_id, numero, status, client_id) VALUES (current_setting('rb.owner')::uuid,'00000000-0000-4000-8000-00000000c001','RB-A1','brouillon','00000000-0000-4000-8000-0000000c1a01')$$)),
 ('assistant_pv_signe', pg_temp.try($$INSERT INTO pv (owner_id, company_id, numero, status) VALUES (current_setting('rb.owner')::uuid,'00000000-0000-4000-8000-00000000c001','RB-A2','signe')$$)),
 ('assistant_draft_company_sig', pg_temp.try($$UPDATE pv SET company_signature='data:x' WHERE id='00000000-0000-4000-8000-0000000000b1'$$)),
 ('assistant_foreign_client', pg_temp.try($$INSERT INTO pv (owner_id, company_id, numero, status, client_id) VALUES (current_setting('rb.owner')::uuid,'00000000-0000-4000-8000-00000000c001','RB-A3','brouillon','00000000-0000-4000-8000-0000000c1b01')$$)),
 ('assistant_reserve_validee', pg_temp.try($$UPDATE pv_reserves SET status='validee' WHERE id='00000000-0000-4000-8000-0000000000d1'$$)),
 ('assistant_lift_report', pg_temp.try($$INSERT INTO reserve_lift_reports (pv_id, company_id, owner_id, numero) VALUES ('00000000-0000-4000-8000-0000000000b1','00000000-0000-4000-8000-00000000c001',current_setting('rb.owner')::uuid,'RB-L')$$));
-- Conducteur (signataire)
SELECT pg_temp.as_user(current_setting('rb.u2')::uuid,'authenticated');
INSERT INTO r VALUES
 ('conducteur_pv_sig', pg_temp.try($$UPDATE pv SET company_signature='data:x' WHERE id='00000000-0000-4000-8000-0000000000b1'$$)),
 ('conducteur_reserve_levee', pg_temp.try($$UPDATE pv_reserves SET status='levee' WHERE id='00000000-0000-4000-8000-0000000000d1'$$));
RESET ROLE;
-- Flux serveur service_role (après ses propres contrôles) non bloqué par les triggers
SELECT pg_temp.as_user(current_setting('rb.u1')::uuid,'service_role');
INSERT INTO r VALUES ('service_role_reserve_validee', pg_temp.try($$UPDATE pv_reserves SET status='validee' WHERE id='00000000-0000-4000-8000-0000000000d1'$$));

-- Fin : l'exception annule TOUTE la transaction et renvoie les résultats (rien n'est jamais validé).
DO $$ BEGIN RAISE EXCEPTION 'RB_RESULTS %', (SELECT string_agg(k || '=' || v, ' ; ' ORDER BY k) FROM r); END $$;

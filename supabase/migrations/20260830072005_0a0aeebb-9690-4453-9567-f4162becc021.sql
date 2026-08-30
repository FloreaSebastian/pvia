-- Corrective, ciblée : remplace le GRANT large accordé à `authenticated`
-- (migration 20260830070939) par une liste blanche prouvée.
--
-- Preuves :
--   * `anon` ne dispose d'AUCUN privilège de table dans `public`
--     (information_schema.role_table_grants → 0 ligne) : aucun flux public ne
--     passe par PostgREST en tant qu'anon. Les parcours publics (signature,
--     OTP, espace client passwordless, webhooks) passent tous par des server
--     functions utilisant le rôle serveur.
--   * Aucune policy RLS ne référence les fonctions réservées au serveur.
--   * La liste blanche ci-dessous = fonctions référencées dans les policies
--     RLS ∪ fonctions appelées via `.rpc(` avec le client utilisateur.
DO $$
DECLARE
  r record;
  allow text[] := ARRAY[
    -- Référencées par les policies RLS (évaluées avec le rôle appelant)
    'can_edit_technical_visit','can_manage_company','can_write_company',
    'can_write_company_admin','can_write_company_member',
    'company_has_write_access','has_role','is_company_admin',
    'is_company_member','is_company_owner','is_platform_admin',
    -- Appelées explicitement par l'application avec le client utilisateur
    'can_add_member','can_create_pv','can_read_technical_visit',
    'generate_next_pv_number','get_company_member_count','get_company_plan',
    'get_company_pv_count_current_period','get_company_role',
    'get_company_seat_usage','has_plan_feature','next_chantier_photo_label'
  ];
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND pg_get_function_result(p.oid) <> 'trigger'
      AND NOT (p.proname = ANY(allow))
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;
-- Les fonctions de trigger n'ont pas à être appelables directement : Postgres
-- vérifie le privilège EXECUTE au moment du CREATE TRIGGER, pas à chaque
-- déclenchement. Un ancien GRANT global les avait rendues appelables par
-- `authenticated`.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND pg_get_function_result(p.oid) = 'trigger'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated, anon, PUBLIC', r.sig);
  END LOOP;
END $$;
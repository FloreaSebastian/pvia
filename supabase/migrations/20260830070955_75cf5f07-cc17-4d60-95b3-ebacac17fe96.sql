DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND p.proname IN (
        'consume_signature_otp',
        'resolve_client_identity',
        'enqueue_webhook_event',
        'increment_rate_limit',
        'cleanup_analytics_events',
        'cleanup_client_auth',
        'cleanup_rate_limits',
        '_chantier_audit',
        'generate_chantier_reference',
        'generate_next_reserve_lift_number',
        'has_active_subscription',
        'company_trial_consumed'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;
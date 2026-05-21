-- Espace client passwordless (magic code)

CREATE TABLE IF NOT EXISTS public.client_auth_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid,
  email text NOT NULL,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text
);

CREATE INDEX IF NOT EXISTS idx_client_auth_codes_email_at
  ON public.client_auth_codes (email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_auth_codes_expires
  ON public.client_auth_codes (expires_at);

ALTER TABLE public.client_auth_codes ENABLE ROW LEVEL SECURITY;
-- Volontairement aucune policy : seul le service role (server functions) accède.

CREATE TABLE IF NOT EXISTS public.client_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  client_id uuid,
  email text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  ip_address text,
  user_agent text
);

CREATE INDEX IF NOT EXISTS idx_client_sessions_token ON public.client_sessions (token_hash);
CREATE INDEX IF NOT EXISTS idx_client_sessions_client
  ON public.client_sessions (client_id, revoked_at);
CREATE INDEX IF NOT EXISTS idx_client_sessions_email
  ON public.client_sessions (email, revoked_at);

ALTER TABLE public.client_sessions ENABLE ROW LEVEL SECURITY;
-- Volontairement aucune policy : seul le service role (server functions) accède.

CREATE OR REPLACE FUNCTION public.cleanup_client_auth()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.client_auth_codes WHERE created_at < now() - interval '24 hours';
  DELETE FROM public.client_sessions WHERE expires_at < now() - interval '7 days';
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-client-auth-daily') THEN
      PERFORM cron.unschedule('cleanup-client-auth-daily');
    END IF;
    PERFORM cron.schedule(
      'cleanup-client-auth-daily',
      '15 4 * * *',
      $cron$SELECT public.cleanup_client_auth();$cron$
    );
  END IF;
END
$$;
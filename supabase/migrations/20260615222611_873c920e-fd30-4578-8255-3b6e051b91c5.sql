CREATE TABLE public.enterprise_auth_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  code_hash text NOT NULL,
  token_hash text NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX enterprise_auth_codes_email_idx ON public.enterprise_auth_codes (email, created_at DESC);
GRANT ALL ON public.enterprise_auth_codes TO service_role;
ALTER TABLE public.enterprise_auth_codes ENABLE ROW LEVEL SECURITY;
-- No client policies: server-only access via supabaseAdmin.
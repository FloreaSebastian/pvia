-- Remove plaintext invite token column (never used: only SHA-256 hash is stored)
ALTER TABLE public.company_members DROP COLUMN IF EXISTS invite_token;

-- Prevent any client (member or not) from reading the invite token hash.
-- Server-side invite verification uses the service role, which is unaffected.
REVOKE SELECT ON public.company_members FROM authenticated;
REVOKE SELECT ON public.company_members FROM anon;

GRANT SELECT (
  id, company_id, user_id, role, status, invited_email,
  created_at, invite_expires_at, accepted_at, invited_by
) ON public.company_members TO authenticated;

GRANT ALL ON public.company_members TO service_role;
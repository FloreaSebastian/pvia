-- ============================================================================
-- 1) Fix get_company_plan: drop fragile GUC dependency
--    Prefer environment='live' subscription, fallback latest, no GUC.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_company_plan(_company_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (
      SELECT plan FROM public.subscriptions
       WHERE company_id = _company_id
         AND (
           (status IN ('active','trialing','past_due')
             AND (current_period_end IS NULL OR current_period_end > now()))
           OR (status = 'canceled' AND current_period_end > now())
         )
       ORDER BY (environment = 'live') DESC, created_at DESC
       LIMIT 1
    ),
    'starter'
  );
$$;

-- ============================================================================
-- 2) Hash-only sign tokens
--    - Add sign_token_hash column (sha256 hex) with unique index
--    - Backfill from existing sign_token, then NULL the raw token
-- ============================================================================
ALTER TABLE public.pv
  ADD COLUMN IF NOT EXISTS sign_token_hash text;

CREATE UNIQUE INDEX IF NOT EXISTS pv_sign_token_hash_uniq
  ON public.pv (sign_token_hash)
  WHERE sign_token_hash IS NOT NULL;

-- Backfill: hash existing tokens (pgcrypto.digest)
UPDATE public.pv
   SET sign_token_hash = encode(extensions.digest(sign_token::bytea, 'sha256'), 'hex'),
       sign_token      = NULL
 WHERE sign_token IS NOT NULL
   AND sign_token_hash IS NULL;

-- Purge any leftover raw tokens (defense in depth)
UPDATE public.pv SET sign_token = NULL WHERE sign_token IS NOT NULL;

-- ============================================================================
-- 3) eIDAS evidence columns for remote/client signature
--    (set ONLY during the en_attente → signe transition; locked thereafter)
-- ============================================================================
ALTER TABLE public.pv
  ADD COLUMN IF NOT EXISTS client_signature_ip         inet,
  ADD COLUMN IF NOT EXISTS client_signature_user_agent text,
  ADD COLUMN IF NOT EXISTS consent_text                text,
  ADD COLUMN IF NOT EXISTS consent_at                  timestamptz;

COMMENT ON COLUMN public.pv.sign_token_hash IS 'SHA-256 hex of the remote-signature token. Raw token is never stored — only emailed to the recipient.';
COMMENT ON COLUMN public.pv.client_signature_ip IS 'IP of the client at signature time (eIDAS SES evidence).';
COMMENT ON COLUMN public.pv.client_signature_user_agent IS 'User-Agent of the client at signature time (eIDAS SES evidence).';
COMMENT ON COLUMN public.pv.consent_text IS 'Exact wording the client accepted at signature time, archived as evidence.';
COMMENT ON COLUMN public.pv.consent_at IS 'Timestamp the consent checkbox was confirmed.';
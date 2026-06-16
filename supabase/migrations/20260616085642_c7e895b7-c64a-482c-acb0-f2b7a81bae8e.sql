
-- 1) Revoke column-level SELECT of secret credentials & sensitive PII from anon/authenticated.
--    Service role keeps full access (BYPASSRLS).

-- company_members: invite tokens are server-only secrets
REVOKE SELECT (invite_token, invite_token_hash) ON public.company_members FROM authenticated, anon;

-- pv: sign tokens are signing credentials; client_signature_ip is auditing-only
REVOKE SELECT (sign_token, sign_token_hash, client_signature_ip) ON public.pv FROM authenticated, anon;

-- 2) Tighten realtime channel policy: enforce exact prefix match for known channel
--    naming conventions instead of permissive suffix LIKE.
DROP POLICY IF EXISTS authenticated_postgres_changes_only ON realtime.messages;

CREATE POLICY authenticated_postgres_changes_only
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  extension = 'postgres_changes'
  AND EXISTS (
    SELECT 1
    FROM public.company_members cm
    WHERE cm.user_id = auth.uid()
      AND cm.status = 'active'
      AND (
        realtime.topic() = 'notif-'   || cm.company_id::text
        OR realtime.topic() = 'billing-' || cm.company_id::text
        OR realtime.topic() = 'bn-'      || cm.company_id::text
      )
  )
);

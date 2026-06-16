-- 1) push_subscriptions: explicit INSERT policy
DROP POLICY IF EXISTS push_sub_insert_own ON public.push_subscriptions;
CREATE POLICY push_sub_insert_own ON public.push_subscriptions
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.is_company_member(company_id, auth.uid())
  );

-- 2) pv.sign_token / sign_token_hash: column-level REVOKE for anon/authenticated
REVOKE SELECT (sign_token, sign_token_hash) ON public.pv FROM anon;
REVOKE SELECT (sign_token, sign_token_hash) ON public.pv FROM authenticated;
REVOKE UPDATE (sign_token, sign_token_hash) ON public.pv FROM anon;
REVOKE UPDATE (sign_token, sign_token_hash) ON public.pv FROM authenticated;
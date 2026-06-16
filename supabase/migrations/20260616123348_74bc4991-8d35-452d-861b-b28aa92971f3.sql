-- Lock down writes on app_errors and webhook_deliveries to service_role only
REVOKE INSERT, UPDATE, DELETE ON public.app_errors FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.webhook_deliveries FROM anon, authenticated;

-- Allow company members to read coworker profiles (names/avatars for member listings)
DROP POLICY IF EXISTS "Members can view coworker profiles" ON public.profiles;
CREATE POLICY "Members can view coworker profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.company_members me
    JOIN public.company_members other
      ON other.company_id = me.company_id
    WHERE me.user_id = auth.uid()
      AND me.status = 'active'
      AND other.user_id = public.profiles.id
      AND other.status = 'active'
  )
);

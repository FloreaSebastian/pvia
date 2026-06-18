
-- app_errors: allow authenticated users to insert their own error reports
CREATE POLICY app_errors_insert_self
ON public.app_errors
FOR INSERT TO authenticated
WITH CHECK (
  user_id IS NULL OR user_id = auth.uid()
);

GRANT INSERT ON public.app_errors TO authenticated;

-- Restrict notifications INSERT: all writes go through supabaseAdmin server-side.
DROP POLICY IF EXISTS notif_insert ON public.notifications;

-- Ensure RLS is enabled on app_errors (defense-in-depth; inserts already
-- only happen via supabaseAdmin in monitoring.server.ts).
ALTER TABLE public.app_errors ENABLE ROW LEVEL SECURITY;

-- Remove overly-permissive anon SELECT policies that exposed sign tokens
-- and invitation data to anyone holding the publishable anon key.
-- All sign / invite flows are handled via server functions using supabaseAdmin.

DROP POLICY IF EXISTS pv_select_by_token        ON public.pv;
DROP POLICY IF EXISTS pv_photos_select_by_token  ON public.pv_photos;
DROP POLICY IF EXISTS pv_reserves_select_by_token ON public.pv_reserves;
DROP POLICY IF EXISTS companies_select_by_pv_token ON public.companies;
DROP POLICY IF EXISTS members_select_by_token    ON public.company_members;

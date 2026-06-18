
-- pv_photos: split the catch-all write policy so technicians (is_company_member)
-- can INSERT photo rows — aligned with the pv-assets storage bucket policy.
-- UPDATE/DELETE remain restricted to management roles.
DROP POLICY IF EXISTS pv_photos_write ON public.pv_photos;

CREATE POLICY pv_photos_insert_member
ON public.pv_photos
FOR INSERT TO authenticated
WITH CHECK (public.is_company_member(company_id, auth.uid()));

CREATE POLICY pv_photos_update_managers
ON public.pv_photos
FOR UPDATE TO authenticated
USING (public.can_manage_company(company_id, auth.uid()))
WITH CHECK (public.can_manage_company(company_id, auth.uid()));

CREATE POLICY pv_photos_delete_managers
ON public.pv_photos
FOR DELETE TO authenticated
USING (public.can_manage_company(company_id, auth.uid()));

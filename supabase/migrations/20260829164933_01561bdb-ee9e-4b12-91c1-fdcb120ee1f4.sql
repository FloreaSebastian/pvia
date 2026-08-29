-- 1. Helpers centraux : rôle + droit d'écriture abonnement
CREATE OR REPLACE FUNCTION public.can_write_company(_company_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can_manage_company(_company_id, _user_id)
     AND public.company_has_write_access(_company_id);
$$;

CREATE OR REPLACE FUNCTION public.can_write_company_member(_company_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_company_member(_company_id, _user_id)
     AND public.company_has_write_access(_company_id);
$$;

CREATE OR REPLACE FUNCTION public.can_write_company_admin(_company_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_company_admin(_company_id, _user_id)
     AND public.company_has_write_access(_company_id);
$$;

REVOKE EXECUTE ON FUNCTION public.can_write_company(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.can_write_company_member(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.can_write_company_admin(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_write_company(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_write_company_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_write_company_admin(uuid, uuid) TO authenticated;

-- 2. Visites techniques : la garde entre dans la fonction d'édition
CREATE OR REPLACE FUNCTION public.can_edit_technical_visit(_visit_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.technical_visits v
    WHERE v.id = _visit_id
      AND v.status NOT IN ('validee', 'archivee')
      AND public.company_has_write_access(v.company_id)
      AND (
        public.can_manage_company(v.company_id, _user_id)
        OR (v.assigned_to = _user_id AND public.is_company_member(v.company_id, _user_id))
      )
  );
$$;

-- 3. Chantiers / clients / PV
DROP POLICY IF EXISTS chantiers_write ON public.chantiers;
CREATE POLICY chantiers_write ON public.chantiers FOR ALL TO authenticated
  USING (public.can_write_company(company_id, auth.uid()))
  WITH CHECK (public.can_write_company(company_id, auth.uid()));

DROP POLICY IF EXISTS clients_write ON public.clients;
CREATE POLICY clients_write ON public.clients FOR ALL TO authenticated
  USING (public.can_write_company(company_id, auth.uid()))
  WITH CHECK (public.can_write_company(company_id, auth.uid()));

DROP POLICY IF EXISTS pv_insert ON public.pv;
CREATE POLICY pv_insert ON public.pv FOR INSERT TO authenticated
  WITH CHECK (public.can_write_company(company_id, auth.uid()));
DROP POLICY IF EXISTS pv_update ON public.pv;
CREATE POLICY pv_update ON public.pv FOR UPDATE TO authenticated
  USING (public.can_write_company(company_id, auth.uid()))
  WITH CHECK (public.can_write_company(company_id, auth.uid()));
DROP POLICY IF EXISTS pv_delete ON public.pv;
CREATE POLICY pv_delete ON public.pv FOR DELETE TO authenticated
  USING (public.can_write_company(company_id, auth.uid()));

DROP POLICY IF EXISTS pv_reserves_write ON public.pv_reserves;
CREATE POLICY pv_reserves_write ON public.pv_reserves FOR ALL TO authenticated
  USING (public.can_write_company(company_id, auth.uid()))
  WITH CHECK (public.can_write_company(company_id, auth.uid()));

DROP POLICY IF EXISTS pv_photos_insert_member ON public.pv_photos;
CREATE POLICY pv_photos_insert_member ON public.pv_photos FOR INSERT TO authenticated
  WITH CHECK (public.can_write_company_member(company_id, auth.uid()));
DROP POLICY IF EXISTS pv_photos_update_managers ON public.pv_photos;
CREATE POLICY pv_photos_update_managers ON public.pv_photos FOR UPDATE TO authenticated
  USING (public.can_write_company(company_id, auth.uid()))
  WITH CHECK (public.can_write_company(company_id, auth.uid()));
DROP POLICY IF EXISTS pv_photos_delete_managers ON public.pv_photos;
CREATE POLICY pv_photos_delete_managers ON public.pv_photos FOR DELETE TO authenticated
  USING (public.can_write_company(company_id, auth.uid()));

DROP POLICY IF EXISTS pv_documents_insert_managers ON public.pv_documents;
CREATE POLICY pv_documents_insert_managers ON public.pv_documents FOR INSERT TO authenticated
  WITH CHECK (public.can_write_company(company_id, auth.uid()));
DROP POLICY IF EXISTS pv_documents_update_managers ON public.pv_documents;
CREATE POLICY pv_documents_update_managers ON public.pv_documents FOR UPDATE TO authenticated
  USING (public.can_write_company(company_id, auth.uid()))
  WITH CHECK (public.can_write_company(company_id, auth.uid()));
DROP POLICY IF EXISTS pv_documents_delete_admins ON public.pv_documents;
CREATE POLICY pv_documents_delete_admins ON public.pv_documents FOR DELETE TO authenticated
  USING (public.can_write_company_admin(company_id, auth.uid()));

-- 4. Sous-objets chantier
DROP POLICY IF EXISTS cd_insert ON public.chantier_documents;
CREATE POLICY cd_insert ON public.chantier_documents FOR INSERT TO authenticated
  WITH CHECK (public.can_write_company(company_id, auth.uid()));
DROP POLICY IF EXISTS cd_update ON public.chantier_documents;
CREATE POLICY cd_update ON public.chantier_documents FOR UPDATE TO authenticated
  USING (public.can_write_company(company_id, auth.uid()))
  WITH CHECK (public.can_write_company(company_id, auth.uid()));
DROP POLICY IF EXISTS cd_delete ON public.chantier_documents;
CREATE POLICY cd_delete ON public.chantier_documents FOR DELETE TO authenticated
  USING (public.can_write_company_admin(company_id, auth.uid()));

DROP POLICY IF EXISTS ce_insert ON public.chantier_events;
CREATE POLICY ce_insert ON public.chantier_events FOR INSERT TO authenticated
  WITH CHECK (public.can_write_company(company_id, auth.uid()));
DROP POLICY IF EXISTS ce_update ON public.chantier_events;
CREATE POLICY ce_update ON public.chantier_events FOR UPDATE TO authenticated
  USING (public.can_write_company(company_id, auth.uid()))
  WITH CHECK (public.can_write_company(company_id, auth.uid()));
DROP POLICY IF EXISTS ce_delete ON public.chantier_events;
CREATE POLICY ce_delete ON public.chantier_events FOR DELETE TO authenticated
  USING (public.can_write_company_admin(company_id, auth.uid()));

DROP POLICY IF EXISTS cn_insert ON public.chantier_notes;
CREATE POLICY cn_insert ON public.chantier_notes FOR INSERT TO authenticated
  WITH CHECK (public.can_write_company(company_id, auth.uid()));
DROP POLICY IF EXISTS cn_update ON public.chantier_notes;
CREATE POLICY cn_update ON public.chantier_notes FOR UPDATE TO authenticated
  USING (public.can_write_company(company_id, auth.uid()))
  WITH CHECK (public.can_write_company(company_id, auth.uid()));
DROP POLICY IF EXISTS cn_delete ON public.chantier_notes;
CREATE POLICY cn_delete ON public.chantier_notes FOR DELETE TO authenticated
  USING (public.can_write_company_admin(company_id, auth.uid()));

DROP POLICY IF EXISTS cph_insert ON public.chantier_photos;
CREATE POLICY cph_insert ON public.chantier_photos FOR INSERT TO authenticated
  WITH CHECK (public.can_write_company(company_id, auth.uid()));
DROP POLICY IF EXISTS cph_update ON public.chantier_photos;
CREATE POLICY cph_update ON public.chantier_photos FOR UPDATE TO authenticated
  USING (public.can_write_company(company_id, auth.uid()))
  WITH CHECK (public.can_write_company(company_id, auth.uid()));
DROP POLICY IF EXISTS cph_delete ON public.chantier_photos;
CREATE POLICY cph_delete ON public.chantier_photos FOR DELETE TO authenticated
  USING (public.can_write_company(company_id, auth.uid()));

-- 5. Levées de réserves
DROP POLICY IF EXISTS reserve_lift_reports_insert ON public.reserve_lift_reports;
CREATE POLICY reserve_lift_reports_insert ON public.reserve_lift_reports FOR INSERT TO authenticated
  WITH CHECK (public.can_write_company(company_id, auth.uid()));
DROP POLICY IF EXISTS reserve_lift_reports_update ON public.reserve_lift_reports;
CREATE POLICY reserve_lift_reports_update ON public.reserve_lift_reports FOR UPDATE TO authenticated
  USING (public.can_write_company(company_id, auth.uid()))
  WITH CHECK (public.can_write_company(company_id, auth.uid()));
DROP POLICY IF EXISTS reserve_lift_reports_delete ON public.reserve_lift_reports;
CREATE POLICY reserve_lift_reports_delete ON public.reserve_lift_reports FOR DELETE TO authenticated
  USING (public.can_write_company_admin(company_id, auth.uid()));

DROP POLICY IF EXISTS reserve_lift_items_write ON public.reserve_lift_items;
CREATE POLICY reserve_lift_items_write ON public.reserve_lift_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.reserve_lift_reports r
                  WHERE r.id = reserve_lift_items.report_id
                    AND public.can_write_company(r.company_id, auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.reserve_lift_reports r
                  WHERE r.id = reserve_lift_items.report_id
                    AND public.can_write_company(r.company_id, auth.uid())));

DROP POLICY IF EXISTS "managers insert photos" ON public.reserve_lift_item_photos;
CREATE POLICY "managers insert photos" ON public.reserve_lift_item_photos FOR INSERT TO authenticated
  WITH CHECK (public.can_write_company(company_id, auth.uid()));
DROP POLICY IF EXISTS "managers update photos" ON public.reserve_lift_item_photos;
CREATE POLICY "managers update photos" ON public.reserve_lift_item_photos FOR UPDATE TO authenticated
  USING (public.can_write_company(company_id, auth.uid()))
  WITH CHECK (public.can_write_company(company_id, auth.uid()));
DROP POLICY IF EXISTS "managers delete photos" ON public.reserve_lift_item_photos;
CREATE POLICY "managers delete photos" ON public.reserve_lift_item_photos FOR DELETE TO authenticated
  USING (public.can_write_company(company_id, auth.uid()));

-- 6. Visites techniques (table parente)
DROP POLICY IF EXISTS tv_insert ON public.technical_visits;
CREATE POLICY tv_insert ON public.technical_visits FOR INSERT TO authenticated
  WITH CHECK (public.can_write_company(company_id, auth.uid()));
DROP POLICY IF EXISTS tv_update ON public.technical_visits;
CREATE POLICY tv_update ON public.technical_visits FOR UPDATE TO authenticated
  USING (public.company_has_write_access(company_id) AND (
          public.can_manage_company(company_id, auth.uid())
          OR (assigned_to = auth.uid() AND status <> ALL (ARRAY['validee','archivee'])
              AND public.is_company_member(company_id, auth.uid()))))
  WITH CHECK (public.company_has_write_access(company_id) AND (
          public.can_manage_company(company_id, auth.uid())
          OR (assigned_to = auth.uid() AND public.is_company_member(company_id, auth.uid()))));
DROP POLICY IF EXISTS tv_delete ON public.technical_visits;
CREATE POLICY tv_delete ON public.technical_visits FOR DELETE TO authenticated
  USING (public.can_write_company(company_id, auth.uid()));

-- 7. Conformité + invitations de membres (consomme un siège)
DROP POLICY IF EXISTS compliance_modify_admin ON public.compliance_checklist_items;
CREATE POLICY compliance_modify_admin ON public.compliance_checklist_items FOR ALL TO authenticated
  USING (public.can_write_company_admin(company_id, auth.uid()) OR public.is_platform_admin(auth.uid()))
  WITH CHECK (public.can_write_company_admin(company_id, auth.uid()) OR public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS members_insert ON public.company_members;
CREATE POLICY members_insert ON public.company_members FOR INSERT TO authenticated
  WITH CHECK (public.can_write_company_admin(company_id, auth.uid())
              AND (role <> 'directeur'::company_role OR public.is_company_owner(company_id, auth.uid())));

-- 8. Stockage : dépôt de nouveaux fichiers métier
DROP POLICY IF EXISTS pv_assets_insert_company ON storage.objects;
CREATE POLICY pv_assets_insert_company ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'pv-assets'
              AND auth.uid() IS NOT NULL
              AND public.can_write_company_member(((storage.foldername(name))[1])::uuid, auth.uid()));
DROP POLICY IF EXISTS pv_assets_update_company ON storage.objects;
CREATE POLICY pv_assets_update_company ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'pv-assets'
         AND auth.uid() IS NOT NULL
         AND public.can_write_company(((storage.foldername(name))[1])::uuid, auth.uid()));
DROP POLICY IF EXISTS pv_assets_delete_company ON storage.objects;
CREATE POLICY pv_assets_delete_company ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'pv-assets'
         AND auth.uid() IS NOT NULL
         AND public.can_write_company(((storage.foldername(name))[1])::uuid, auth.uid()));
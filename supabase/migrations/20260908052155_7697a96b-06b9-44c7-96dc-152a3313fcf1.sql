-- Notifications : lecture/màj de SES propres notifications par un sous-traitant actif du tenant.
CREATE POLICY "notif_select_subcontractor"
ON public.notifications
FOR SELECT
TO authenticated
USING (user_id = auth.uid() AND public.is_active_subcontractor(company_id, auth.uid()));

CREATE POLICY "notif_update_subcontractor"
ON public.notifications
FOR UPDATE
TO authenticated
USING (user_id = auth.uid() AND public.is_active_subcontractor(company_id, auth.uid()))
WITH CHECK (user_id = auth.uid() AND public.is_active_subcontractor(company_id, auth.uid()));

-- Push : un sous-traitant actif peut enregistrer SON appareil pour CE tenant.
CREATE POLICY "push_sub_insert_subcontractor"
ON public.push_subscriptions
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid() AND public.is_active_subcontractor(company_id, auth.uid()));

-- Anti-spam relance : clé logique company + partenaire + motif + type de pièce.
CREATE INDEX IF NOT EXISTS subcontractor_document_reminders_cooldown_idx
ON public.subcontractor_document_reminders (company_id, subcontractor_company_id, reason, doc_type, created_at DESC);
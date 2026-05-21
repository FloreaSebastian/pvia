
CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid,
  user_id uuid,
  pv_id uuid,
  entity_type text NOT NULL,
  entity_id uuid,
  action text NOT NULL,
  old_values jsonb,
  new_values jsonb,
  ip_address text,
  user_agent text,
  metadata jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_company ON public.audit_logs(company_id, created_at DESC);
CREATE INDEX idx_audit_logs_pv ON public.audit_logs(pv_id, created_at DESC);
CREATE INDEX idx_audit_logs_action ON public.audit_logs(action);
CREATE INDEX idx_audit_logs_entity ON public.audit_logs(entity_type, entity_id);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Les membres actifs peuvent voir les logs de leur entreprise
CREATE POLICY "audit_logs_select_member"
ON public.audit_logs
FOR SELECT
USING (company_id IS NOT NULL AND public.is_company_member(company_id, auth.uid()));

-- Pas d'INSERT/UPDATE/DELETE depuis les clients : seuls le service_role
-- (server functions admin) et les fonctions security definer peuvent écrire.
-- Aucune policy d'écriture = personne ne peut écrire via le client.

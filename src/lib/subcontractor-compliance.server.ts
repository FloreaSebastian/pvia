/**
 * Recalcul serveur de la conformité documentaire d'un partenaire.
 * Utilisé par l'affectation à un chantier et par le cron d'alertes.
 * Le tenant doit avoir été vérifié par l'appelant.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { computeCompliance, type ComplianceSummary } from "./subcontractor-compliance";

export async function computeComplianceForPartner(
  companyId: string,
  subcontractorCompanyId: string,
  now: Date = new Date(),
): Promise<ComplianceSummary> {
  const [docs, rules] = await Promise.all([
    supabaseAdmin
      .from("subcontractor_documents")
      .select("id,doc_type,label,expiry_date,issue_date,is_required,is_blocking,archived_at,review_status,rejection_reason")
      .eq("company_id", companyId)
      .eq("subcontractor_company_id", subcontractorCompanyId),
    supabaseAdmin
      .from("subcontractor_document_rules")
      .select("doc_type,is_required,is_blocking")
      .eq("company_id", companyId)
      .eq("subcontractor_company_id", subcontractorCompanyId),
  ]);

  return computeCompliance((docs.data ?? []) as any, (rules.data ?? []) as any, now);
}

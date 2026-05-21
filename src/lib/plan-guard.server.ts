import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Backend quota & feature gates. Called from server functions before any
 * action that consumes plan quota or requires a premium feature.
 * Sources truth from public.plan_limits + public.subscriptions via RPCs.
 */

export type PlanFeature = "remote_sign" | "advanced_stats" | "export_audit" | "branding";

export async function assertCanCreatePv(companyId: string) {
  const { data, error } = await supabaseAdmin.rpc("can_create_pv", { _company_id: companyId });
  if (error) throw error;
  if (!data) {
    const planRes = await supabaseAdmin.rpc("get_company_plan", { _company_id: companyId });
    throw new Error(
      `Quota PV mensuel atteint pour le plan ${planRes.data || "starter"}. Passez au plan supérieur pour continuer.`,
    );
  }
}

export async function assertCanAddMember(companyId: string) {
  const { data, error } = await supabaseAdmin.rpc("can_add_member", { _company_id: companyId });
  if (error) throw error;
  if (!data) {
    const planRes = await supabaseAdmin.rpc("get_company_plan", { _company_id: companyId });
    throw new Error(
      `Nombre maximum d'utilisateurs atteint pour le plan ${planRes.data || "starter"}. Mettez à niveau pour inviter plus de membres.`,
    );
  }
}

export async function assertPlanFeature(companyId: string, feature: PlanFeature) {
  const { data, error } = await supabaseAdmin.rpc("has_plan_feature", {
    _company_id: companyId,
    _feature: feature,
  });
  if (error) throw error;
  if (!data) {
    const labels: Record<PlanFeature, string> = {
      remote_sign: "Signature à distance",
      advanced_stats: "Statistiques avancées",
      export_audit: "Export de l'historique d'audit",
      branding: "Branding personnalisé",
    };
    throw new Error(`Fonctionnalité « ${labels[feature]} » non incluse dans votre plan actuel.`);
  }
}

export async function getCompanyPlan(companyId: string): Promise<string> {
  const { data } = await supabaseAdmin.rpc("get_company_plan", { _company_id: companyId });
  return (data as string) || "starter";
}

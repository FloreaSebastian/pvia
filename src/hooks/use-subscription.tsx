import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect } from "react";
import { useCompany } from "./use-company";
import { getCompanyBilling } from "@/lib/billing.functions";
import { supabase } from "@/integrations/supabase/client";

export function useSubscription() {
  const { activeCompanyId } = useCompany();
  const fetchBilling = useServerFn(getCompanyBilling);

  const query = useQuery({
    queryKey: ["billing", activeCompanyId],
    queryFn: () => fetchBilling({ data: { companyId: activeCompanyId! } }),
    enabled: !!activeCompanyId,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!activeCompanyId) return;
    const ch = supabase
      .channel(`billing-${activeCompanyId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "subscriptions", filter: `company_id=eq.${activeCompanyId}` },
        () => query.refetch(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [activeCompanyId, query]);

  const access = query.data?.access ?? null;

  return {
    ...query,
    plan: query.data?.plan ?? "starter",
    limits: query.data?.limits ?? null,
    usage: query.data?.usage ?? { pv_this_period: 0, members: 0 },
    subscription: query.data?.subscription ?? null,
    allPlans: query.data?.allPlans ?? [],
    access,
    blocked: access?.blocked ?? false,
    isTrialing: access?.state === "trialing",
    /** True if current plan grants this feature. */
    hasFeature: (feature: "remote_sign" | "advanced_stats" | "export_audit" | "branding") => {
      const lim = query.data?.limits as any;
      if (!lim) return false;
      const map: Record<string, keyof typeof lim> = {
        remote_sign: "can_remote_sign",
        advanced_stats: "can_advanced_stats",
        export_audit: "can_export_audit",
        branding: "can_branding",
      };
      return Boolean(lim[map[feature]]);
    },
  };
}

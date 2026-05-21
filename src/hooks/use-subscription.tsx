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

  // Realtime: refetch when subscriptions row changes
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

  return {
    ...query,
    plan: query.data?.plan ?? "starter",
    limits: query.data?.limits ?? null,
    usage: query.data?.usage ?? { pv_this_period: 0, members: 0 },
    subscription: query.data?.subscription ?? null,
    allPlans: query.data?.allPlans ?? [],
  };
}

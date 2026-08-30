import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useId, useRef } from "react";
import { useCompany } from "./use-company";
import { getCompanyBilling } from "@/lib/billing.functions";
import { supabase } from "@/integrations/supabase/client";

export function useSubscription() {
  const { activeCompanyId } = useCompany();
  const fetchBilling = useServerFn(getCompanyBilling);
  // Plusieurs consommateurs (provider, bannière, feature gates) peuvent être
  // montés simultanément. Supabase réutilise un canal de même topic : le second
  // appel à `.on()` arriverait alors après le `.subscribe()` du premier.
  const realtimeInstanceId = useId().replace(/:/g, "");
  const realtimeEffectSequence = useRef(0);

  const query = useQuery({
    queryKey: ["billing", activeCompanyId],
    queryFn: () => fetchBilling({ data: { companyId: activeCompanyId! } }),
    enabled: !!activeCompanyId,
    staleTime: 60_000,
  });
  const { refetch } = query;

  useEffect(() => {
    if (!activeCompanyId) return;
    // Le suffixe par exécution couvre aussi le double montage d'effet de React
    // en développement : removeChannel est asynchrone et l'ancien canal peut
    // encore être enregistré lorsque l'effet suivant démarre.
    realtimeEffectSequence.current += 1;
    const ch = supabase
      .channel(`billing-${activeCompanyId}-${realtimeInstanceId}-${realtimeEffectSequence.current}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "subscriptions", filter: `company_id=eq.${activeCompanyId}` },
        () => void refetch(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [activeCompanyId, realtimeInstanceId, refetch]);

  const access = query.data?.access ?? null;

  return {
    ...query,
    plan: query.data?.plan ?? "starter",
    limits: query.data?.limits ?? null,
    usage: query.data?.usage ?? { pv_this_period: 0, members: 0, seats: 0 },
    subscription: query.data?.subscription ?? null,
    allPlans: query.data?.allPlans ?? [],
    access,
    /** Une entreprise = un seul essai à vie. */
    trialEligible: query.data?.trialEligible ?? false,
    blocked: access?.blocked ?? false,
    isTrialing: access?.state === "trialing",
    /** True if current plan grants this feature. */
    hasFeature: (
      feature: "remote_sign" | "advanced_stats" | "export_audit" | "branding" | "technical_visits",
    ) => {
      const lim = query.data?.limits as any;
      if (!lim) return false;
      const map: Record<string, keyof typeof lim> = {
        remote_sign: "can_remote_sign",
        advanced_stats: "can_advanced_stats",
        export_audit: "can_export_audit",
        branding: "can_branding",
        technical_visits: "can_technical_visits",
      };
      return Boolean(lim[map[feature]]);
    },
  };
}

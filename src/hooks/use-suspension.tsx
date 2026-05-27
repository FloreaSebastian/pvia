import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/hooks/use-company";

export type SuspensionInfo = {
  suspended: boolean;
  reason: string | null;
  status: string | null;
  companyName: string | null;
};

/**
 * Returns suspension status for the active company.
 * Read via RLS (members can SELECT companies).
 */
export function useSuspension(): SuspensionInfo & { isLoading: boolean } {
  const { activeCompanyId } = useCompany();
  const { data, isLoading } = useQuery({
    queryKey: ["company-suspension", activeCompanyId],
    queryFn: async (): Promise<SuspensionInfo> => {
      if (!activeCompanyId)
        return { suspended: false, reason: null, status: null, companyName: null };
      const { data } = await supabase
        .from("companies")
        .select("name,suspended_at,suspension_reason,support_status")
        .eq("id", activeCompanyId)
        .maybeSingle();
      const suspended =
        !!data?.suspended_at || data?.support_status === "blocked";
      return {
        suspended,
        reason: (data?.suspension_reason as string | null) ?? null,
        status: (data?.support_status as string | null) ?? null,
        companyName: (data?.name as string | null) ?? null,
      };
    },
    enabled: !!activeCompanyId,
    staleTime: 30_000,
  });
  return {
    suspended: data?.suspended ?? false,
    reason: data?.reason ?? null,
    status: data?.status ?? null,
    companyName: data?.companyName ?? null,
    isLoading,
  };
}

/**
 * Detects a COMPANY_SUSPENDED:<reason> error thrown by the server.
 * Returns the reason or null.
 */
export function getSuspensionReasonFromError(err: unknown): string | null {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  const m = msg.match(/COMPANY_SUSPENDED:(.*)$/);
  if (!m) return null;
  return (m[1] || "support").trim();
}

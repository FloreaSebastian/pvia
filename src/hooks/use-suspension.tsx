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
export function useSuspension(): SuspensionInfo & { isLoading: boolean; isError: boolean } {
  const { activeCompanyId } = useCompany();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["company-suspension", activeCompanyId],
    queryFn: async (): Promise<SuspensionInfo> => {
      if (!activeCompanyId) throw new Error("Aucune entreprise active.");
      const { data, error } = await supabase
        .from("companies")
        .select("name,suspended_at,suspension_reason,support_status")
        .eq("id", activeCompanyId)
        .maybeSingle();
      return interpretSuspensionRow(data, error);
    },
    enabled: !!activeCompanyId,
    staleTime: 30_000,
  });
  // Sans entreprise ou sans réponse : état inconnu, jamais « accès confirmé ».
  const unknown = !activeCompanyId;
  return {
    suspended: data?.suspended ?? false,
    reason: data?.reason ?? null,
    status: data?.status ?? null,
    companyName: data?.companyName ?? null,
    isLoading: !unknown && (isLoading || (!data && !isError)),
    isError: unknown || isError,
  };
}

type SuspensionRow = {
  name?: string | null;
  suspended_at?: string | null;
  suspension_reason?: string | null;
  support_status?: string | null;
};

/**
 * Lecture du statut : une erreur OU une ligne absente (entreprise invisible)
 * ne doit jamais être lue comme « non suspendu ».
 */
export function interpretSuspensionRow(
  data: SuspensionRow | null | undefined,
  error: unknown,
): SuspensionInfo {
  if (error) throw new Error("Statut de l'entreprise indisponible.");
  if (!data) throw new Error("Entreprise introuvable : accès non confirmé.");
  return {
    suspended: !!data.suspended_at || data.support_status === "blocked",
    reason: data.suspension_reason ?? null,
    status: data.support_status ?? null,
    companyName: data.name ?? null,
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

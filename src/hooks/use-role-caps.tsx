import { useCompany } from "@/hooks/use-company";
import { useBillingGate } from "@/components/billing/BillingGate";
import { roleCapabilities, type RoleCapabilities } from "@/lib/role-access";

/**
 * Capacités réelles de l'utilisateur dans l'entreprise active : rôle × accès
 * d'écriture confirmé (membership, abonnement, suspension). Tant que l'un est
 * inconnu ou en erreur, toutes les capacités d'écriture sont fermées.
 */
export function useRoleCaps(): RoleCapabilities & {
  role: string | null;
  /** true quand rôle et accès écriture sont connus (ouverts ou non). */
  known: boolean;
  userId?: never;
} {
  const { activeRole, loading } = useCompany();
  const { writeKnown, blocked } = useBillingGate();
  const caps = roleCapabilities(activeRole, { writeOpen: writeKnown && !blocked });
  return { ...caps, role: activeRole ?? null, known: !loading && writeKnown };
}

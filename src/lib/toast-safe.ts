import { toast } from "sonner";
import { friendlyErrorMessage } from "@/lib/billing-errors";
import { dispatchBillingError } from "@/lib/billing-event";

let installed = false;

/**
 * Filet de sécurité global d'affichage d'erreurs.
 *
 * - remplace tout message technique (SUBSCRIPTION_REQUIRED, erreur Stripe,
 *   « failed to fetch », stack trace…) par un texte lisible en français ;
 * - relaie les blocages d'abonnement/quota/fonctionnalité au
 *   `BillingGateProvider` via `dispatchBillingError`, qui déduplique les
 *   doubles émissions (MutationCache + toast local).
 */
export function installSafeToast() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const original = toast.error.bind(toast);
  (toast as any).error = (message: unknown, ...rest: unknown[]) => {
    dispatchBillingError(message);
    const safe = typeof message === "string" || message instanceof Error ? friendlyErrorMessage(message) : message;
    return (original as any)(safe, ...(rest as []));
  };
}

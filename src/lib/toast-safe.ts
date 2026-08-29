import { toast } from "sonner";
import { classifyBillingError, friendlyErrorMessage } from "@/lib/billing-errors";

let installed = false;

/**
 * Filet de sécurité global d'affichage d'erreurs.
 *
 * - remplace tout message technique (SUBSCRIPTION_REQUIRED, erreur RLS/Stripe,
 *   « failed to fetch », stack trace…) par un texte lisible en français ;
 * - relaie les blocages d'abonnement/quota/fonctionnalité au
 *   `BillingGateProvider`, qui affiche la popup avec le bon CTA.
 *
 * Les pages continuent d'appeler `toast.error(...)` normalement.
 */
export function installSafeToast() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const original = toast.error.bind(toast);
  (toast as any).error = (message: unknown, ...rest: unknown[]) => {
    const block = classifyBillingError(message);
    if (block) {
      window.dispatchEvent(new CustomEvent("pvia:mutation-error", { detail: message }));
    }
    const safe = typeof message === "string" || message instanceof Error ? friendlyErrorMessage(message) : message;
    return (original as any)(safe, ...(rest as []));
  };
}

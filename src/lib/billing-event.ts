import { classifyBillingError, errorMessage } from "@/lib/billing-errors";

export const BILLING_ERROR_EVENT = "pvia:mutation-error";

const WINDOW_MS = 2000;
let lastKey = "";
let lastAt = 0;

/**
 * Source unique de diffusion des blocages d'abonnement vers `BillingGateProvider`.
 * Une même erreur peut remonter deux fois (MutationCache + `toast.error` local) :
 * la déduplication sur une courte fenêtre évite la double ouverture / le
 * clignotement de la modale.
 */
export function dispatchBillingError(err: unknown): boolean {
  if (typeof window === "undefined") return false;
  const block = classifyBillingError(err);
  if (!block) return false;

  const key = `${block.kind}:${errorMessage(err)}`;
  const now = Date.now();
  if (key === lastKey && now - lastAt < WINDOW_MS) return true;
  lastKey = key;
  lastAt = now;

  window.dispatchEvent(new CustomEvent(BILLING_ERROR_EVENT, { detail: err }));
  return true;
}

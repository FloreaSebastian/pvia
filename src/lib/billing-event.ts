import { classifyBillingError, type BillingBlock } from "@/lib/billing-errors";

export const BILLING_ERROR_EVENT = "pvia:mutation-error";

const WINDOW_MS = 2000;
let lastKey = "";
let lastAt = 0;

/** Clé stable dérivée de la CLASSIFICATION, pas du message brut : deux couches
 *  (MutationCache + toast local) peuvent envelopper différemment la même
 *  erreur — la popup ne doit s'ouvrir qu'une fois. */
function blockKey(block: BillingBlock): string {
  switch (block.kind) {
    case "subscription": return `subscription:${block.state}`;
    case "quota": return `quota:${block.quota}`;
    case "feature": return `feature:${block.feature ?? ""}`;
    case "suspended": return `suspended:${block.reason}`;
  }
}

/**
 * Source unique de diffusion des blocages d'abonnement vers `BillingGateProvider`.
 */
export function dispatchBillingError(err: unknown): boolean {
  if (typeof window === "undefined") return false;
  const block = classifyBillingError(err);
  if (!block) return false;

  const key = blockKey(block);
  const now = Date.now();
  if (key === lastKey && now - lastAt < WINDOW_MS) return true;
  lastKey = key;
  lastAt = now;

  window.dispatchEvent(new CustomEvent(BILLING_ERROR_EVENT, { detail: err }));
  return true;
}


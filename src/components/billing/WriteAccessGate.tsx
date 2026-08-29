import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { useBillingGate, subscriptionCopy } from "@/components/billing/BillingGate";

export type RestrictedCopy = { title: string; body: string; cta: string };

/** Copie métier alignée sur l'état d'accès réel (jamais « aucun abonnement »). */
export function restrictedCopy(state: string | undefined): RestrictedCopy {
  const c = subscriptionCopy(state);
  return { title: c.title, body: c.body, cta: c.cta };
}

/**
 * Source unique côté UI. Le serveur (assertCompanyWriteAccess) et la base
 * (RLS company_has_write_access) restent la sécurité réelle.
 */
export function useWriteAccess() {
  const { blocked, isLoading, state } = useBillingGate();
  return { blocked, isLoading, copy: restrictedCopy(state) };
}

/**
 * Bouton de remplacement affiché à la place d'une action de création/modification
 * lorsque l'entreprise est en lecture seule. Clic / tap / Enter / Espace ouvrent
 * la popup d'abonnement centralisée (`BillingGateProvider`).
 */
export function LockedActionButton({
  label,
  children,
  ...buttonProps
}: { label: string } & ButtonProps) {
  const { openSubscription, state } = useBillingGate();
  const copy = restrictedCopy(state);

  return (
    <Button
      {...buttonProps}
      type="button"
      variant={buttonProps.variant ?? "outline"}
      onClick={(e) => {
        e.preventDefault();
        openSubscription(label.toLowerCase());
      }}
      aria-haspopup="dialog"
      title={copy.title}
    >
      <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="truncate">{children ?? label}</span>
      <span className="sr-only"> — action verrouillée, abonnement requis</span>
    </Button>
  );
}

/**
 * Remplace entièrement l'action par un bouton verrouillé quand l'écriture est
 * suspendue. Ne wrappe jamais les enfants : pas d'interception d'événements.
 */
export function WriteAccessGate({
  label,
  children,
  lockedProps,
}: {
  label: string;
  children: ReactNode;
  lockedProps?: ButtonProps;
}) {
  const { blocked, isLoading } = useWriteAccess();
  if (isLoading || !blocked) return <>{children}</>;
  return <LockedActionButton label={label} {...lockedProps} />;
}

/**
 * Garde générique pour les actions de MODIFICATION / SUPPRESSION / ARCHIVAGE
 * déjà rendues (icônes, menus « … », lignes de liste). En lecture seule, le
 * handler n'est jamais exécuté : la popup centralisée s'ouvre avec le contexte
 * de l'action. La consultation (fiche, export, PDF) n'est jamais gardée.
 */
export function useBlockedActionGuard() {
  const { blocked, openSubscription } = useBillingGate();

  function guard<A extends unknown[]>(actionLabel: string, fn: (...args: A) => unknown) {
    return (...args: A) => {
      if (blocked) {
        openSubscription(actionLabel);
        return;
      }
      return fn(...args);
    };
  }

  /** À placer en première ligne d'un handler de mutation : `if (deny("…")) return;`. */
  function deny(actionLabel: string): boolean {
    if (!blocked) return false;
    openSubscription(actionLabel);
    return true;
  }

  // La popup est rendue une seule fois par l'application (BillingGateProvider).
  const dialog = null;

  return { blocked, guard, deny, dialog };
}

import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useSubscription } from "@/hooks/use-subscription";

export type RestrictedCopy = { title: string; body: string; cta: string };

/** Copie métier alignée sur l'état d'accès réel (jamais « aucun abonnement »). */
export function restrictedCopy(state: string | undefined): RestrictedCopy {
  const payment =
    state === "past_due" || state === "unpaid" || state === "incomplete" || state === "incomplete_expired";
  return payment
    ? {
        title: "Votre abonnement nécessite votre attention",
        body:
          "Vos données restent accessibles, mais les nouvelles créations et modifications sont temporairement suspendues.",
        cta: "Régulariser mon abonnement",
      }
    : {
        title: "Votre accès est limité",
        body:
          "Votre essai est terminé. Vos données restent accessibles, mais la création et la modification sont suspendues.",
        cta: "Choisir une formule",
      };
}

/**
 * Source unique côté UI. Le serveur (assertCompanyWriteAccess) et la base
 * (RLS company_has_write_access) restent la sécurité réelle.
 */
export function useWriteAccess() {
  const { blocked, access, isLoading } = useSubscription();
  return { blocked: Boolean(blocked), isLoading, copy: restrictedCopy(access?.state) };
}

/**
 * Bouton de remplacement affiché à la place d'une action de création/modification
 * lorsque l'entreprise est en lecture seule. C'est un vrai <button> : clic souris,
 * tap tactile, Enter/Espace et focus visible fonctionnent nativement (aucun
 * pointer-events-none, aucune composition Radix fragile).
 */
export function LockedActionButton({
  label,
  children,
  ...buttonProps
}: { label: string } & ButtonProps) {
  const [open, setOpen] = useState(false);
  const { copy } = useWriteAccess();

  return (
    <>
      <Button
        {...buttonProps}
        type="button"
        variant={buttonProps.variant ?? "outline"}
        onClick={(e) => {
          e.preventDefault();
          setOpen(true);
        }}
        aria-haspopup="dialog"
        title={copy.title}
      >
        <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{children ?? label}</span>
        <span className="sr-only"> — action verrouillée, abonnement requis</span>
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent className="max-w-[min(28rem,calc(100vw-2rem))]">
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {copy.body} Action concernée : {label.toLowerCase()}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-[44px]">Fermer</AlertDialogCancel>
            <AlertDialogAction asChild className="min-h-[44px]">
              <Link to="/billing">{copy.cta}</Link>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
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
 * handler n'est jamais exécuté : on ouvre l'explication à la place, ce qui
 * évite d'ouvrir un formulaire éditable pour échouer ensuite. La consultation
 * (ouverture d'une fiche, export, PDF) n'est jamais gardée.
 */
export function useBlockedActionGuard() {
  const { blocked, copy } = useWriteAccess();
  const [label, setLabel] = useState<string | null>(null);

  function guard<A extends unknown[]>(actionLabel: string, fn: (...args: A) => unknown) {
    return (...args: A) => {
      if (blocked) {
        setLabel(actionLabel);
        return;
      }
      return fn(...args);
    };
  }

  const dialog = (
    <AlertDialog open={label !== null} onOpenChange={(o) => !o && setLabel(null)}>
      <AlertDialogContent className="max-w-[min(28rem,calc(100vw-2rem))]">
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.title}</AlertDialogTitle>
          <AlertDialogDescription>
            {copy.body}
            {label ? ` Action concernée : ${label}.` : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="min-h-[44px]">Fermer</AlertDialogCancel>
          <AlertDialogAction asChild className="min-h-[44px]">
            <Link to="/billing">{copy.cta}</Link>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { blocked, guard, dialog };
}


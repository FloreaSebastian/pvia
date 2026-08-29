import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
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

/** Copie métier alignée sur l'état d'accès réel (jamais « aucun abonnement »). */
export function restrictedCopy(state: string | undefined) {
  const payment = state === "past_due" || state === "unpaid" || state === "incomplete";
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
 * Encapsule une action de création/modification.
 * En accès restreint, l'action reste visible mais verrouillée : un clic explique
 * la situation et renvoie vers /billing. Le serveur reste la source de vérité.
 */
export function WriteAccessGate({
  children,
  label = "Action indisponible",
}: {
  children: ReactNode;
  label?: string;
}) {
  const { blocked, access, isLoading } = useSubscription();
  const [open, setOpen] = useState(false);

  if (isLoading || !blocked) return <>{children}</>;
  const copy = restrictedCopy(access?.state);

  return (
    <>
      <span
        className="inline-flex cursor-not-allowed opacity-60 [&_a]:pointer-events-none [&_button]:pointer-events-none"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        role="button"
        tabIndex={0}
        aria-label={`${label} — ${copy.title}`}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {children}
      </span>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent className="max-w-[min(28rem,calc(100vw-2rem))]">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Lock className="h-4 w-4 shrink-0" />
              {copy.title}
            </AlertDialogTitle>
            <AlertDialogDescription>{copy.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-[44px]">Fermer</AlertDialogCancel>
            <AlertDialogAction asChild className="min-h-[44px]">
              <Button asChild>
                <Link to="/billing">{copy.cta}</Link>
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

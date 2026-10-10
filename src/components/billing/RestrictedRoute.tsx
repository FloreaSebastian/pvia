import { Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft, CreditCard } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useBillingGate, subscriptionCopy } from "@/components/billing/BillingGate";
import { accessStateLabel, formatFrDate } from "@/lib/plans";
import { useCompany } from "@/hooks/use-company";
import { useSuspension } from "@/hooks/use-suspension";
import { isAdminRole, isManageRole } from "@/lib/roles";


/**
 * Garde de ROUTE pour les pages dont l'unique objet est la création
 * (ex. /pv/new, /visites-techniques/nouvelle). En accès restreint, l'écran
 * de création n'est jamais affiché : l'utilisateur reçoit immédiatement
 * l'explication et le CTA, y compris en arrivant par URL directe.
 * La consultation des pages existantes n'est pas concernée.
 */
export function RestrictedRoute({
  action,
  backTo = "/dashboard",
  require = "manage",
  children,
}: {
  action: string;
  backTo?: "/dashboard" | "/pv" | "/visites-techniques" | "/chantiers";
  /** Capacité de rôle exigée (mêmes règles que le serveur). */
  require?: "manage";
  children: ReactNode;
}) {
  const { blocked, writeKnown, state, trialEnd, periodEnd } = useBillingGate();
  const { activeRole, loading } = useCompany();
  const suspension = useSuspension();
  // Facturation : mêmes rôles que /billing (ADMIN_ROLES). Les autres rôles ne
  // sont jamais renvoyés vers la facturation : ils contactent un administrateur.
  const canBilling = isAdminRole(activeRole);
  // Accès inconnu ou en erreur : jamais de formulaire de création.

  if (loading || (!writeKnown && !blocked)) {
    return (
      <div className="mx-auto w-full max-w-xl p-4 sm:p-6 lg:p-8" role="status" aria-live="polite">
        <Card className="p-5 text-sm text-muted-foreground">Vérification des accès…</Card>
      </div>
    );
  }
  if (require === "manage" && !isManageRole(activeRole)) {
    return (
      <div className="mx-auto w-full max-w-xl p-4 sm:p-6 lg:p-8">
        <Card className="p-5 sm:p-6">
          <h1 className="text-lg font-semibold tracking-tight">Consultation uniquement</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Votre rôle ne permet pas la {action}. Contactez la direction ou le responsable
            d'exploitation si vous en avez besoin.
          </p>
          <Button asChild variant="outline" className="mt-5 min-h-[44px] w-full sm:w-auto">
            <Link to={backTo}>
              <ArrowLeft className="mr-2 h-4 w-4" aria-hidden />
              Retour à la consultation
            </Link>
          </Button>
        </Card>
      </div>
    );
  }
  if (!blocked) return <>{children}</>;

  const copy = subscriptionCopy(state);
  const dateLine =
    state === "trial_expired" && trialEnd
      ? `Essai terminé le ${formatFrDate(trialEnd)}.`
      : periodEnd
        ? `Dernière échéance : ${formatFrDate(periodEnd)}.`
        : null;

  return (
    <div className="mx-auto w-full max-w-xl p-4 sm:p-6 lg:p-8">
      <Card className="overflow-hidden p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden />
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight">{copy.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{copy.body}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              Action demandée : {action}. Statut : {accessStateLabel(state)}.
              {dateLine ? ` ${dateLine}` : ""}
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <Button asChild className="min-h-[44px] w-full sm:w-auto">
            <Link to="/billing">
              <CreditCard className="mr-2 h-4 w-4" aria-hidden />
              {copy.cta}
            </Link>
          </Button>
          <Button asChild variant="ghost" className="min-h-[44px] w-full sm:w-auto">
            <Link to={backTo}>
              <ArrowLeft className="mr-2 h-4 w-4" aria-hidden />
              Continuer en lecture seule
            </Link>
          </Button>
        </div>
      </Card>
    </div>
  );
}

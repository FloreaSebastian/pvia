import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { AlertOctagon, CreditCard, ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSubscription } from "@/hooks/use-subscription";
import { z } from "zod";

const Search = z.object({
  reason: z.string().optional(),
  feature: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/upgrade-required")({
  component: UpgradeRequiredPage,
  validateSearch: (s) => Search.parse(s),
  head: () => ({ meta: [{ title: "Abonnement requis — PVIA" }] }),
});

const STATE_LABELS: Record<string, { title: string; body: string }> = {
  past_due: {
    title: "Paiement en échec",
    body: "Votre dernier paiement Stripe n'a pas pu aboutir. Mettez à jour votre moyen de paiement pour réactiver l'accès.",
  },
  unpaid: {
    title: "Abonnement impayé",
    body: "Toutes les tentatives de prélèvement ont échoué. Régularisez le paiement pour réactiver PVIA.",
  },
  canceled: {
    title: "Abonnement annulé",
    body: "Votre période d'accès est terminée. Reprenez un abonnement pour continuer à utiliser PVIA.",
  },
  trial_expired: {
    title: "Essai gratuit terminé",
    body: "Votre période d'essai de 14 jours est arrivée à son terme. Choisissez un plan pour continuer.",
  },
  incomplete: {
    title: "Abonnement incomplet",
    body: "Le paiement initial n'a pas été confirmé. Relancez le checkout pour finaliser l'abonnement.",
  },
  incomplete_expired: {
    title: "Délai de paiement dépassé",
    body: "Le délai de confirmation du paiement initial est dépassé. Relancez un checkout.",
  },
  paused: {
    title: "Abonnement en pause",
    body: "Votre abonnement est en pause côté Stripe. Reprenez-le depuis le portail de facturation.",
  },
  feature_locked: {
    title: "Fonctionnalité non incluse",
    body: "Cette fonctionnalité n'est pas disponible dans votre plan actuel.",
  },
  pv_quota: {
    title: "Quota PV mensuel atteint",
    body: "Vous avez atteint la limite de PV de votre plan ce mois-ci. Passez à un plan supérieur pour continuer à créer des PV.",
  },
  member_quota: {
    title: "Nombre d'utilisateurs maximum atteint",
    body: "Vous avez atteint le nombre maximum d'utilisateurs pour votre plan. Mettez à niveau pour inviter plus de membres.",
  },
};

function UpgradeRequiredPage() {
  const { reason, feature } = useSearch({ from: "/_authenticated/upgrade-required" });
  const { plan, access, limits } = useSubscription();

  const key = reason ?? access?.state ?? "canceled";
  const info = STATE_LABELS[key] ?? {
    title: "Abonnement requis",
    body: "L'accès à cette fonctionnalité nécessite un abonnement actif.",
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6 lg:p-10">
      <Card className="space-y-5 border-destructive/40 p-8">
        <div className="flex items-center gap-3">
          <div className="rounded-full bg-destructive/10 p-3 text-destructive">
            <AlertOctagon className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{info.title}</h1>
            <p className="text-sm text-muted-foreground">{info.body}</p>
          </div>
        </div>

        <div className="grid gap-3 rounded-lg border bg-muted/40 p-4 text-sm sm:grid-cols-2">
          <div>
            <div className="text-xs uppercase text-muted-foreground">Plan actuel</div>
            <div className="mt-0.5 font-medium">{limits?.display_name ?? plan}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-muted-foreground">État</div>
            <div className="mt-0.5">
              <Badge variant="secondary">{access?.state ?? "inconnu"}</Badge>
            </div>
          </div>
          {feature && (
            <div className="sm:col-span-2">
              <div className="text-xs uppercase text-muted-foreground">Fonctionnalité bloquée</div>
              <div className="mt-0.5 font-mono text-xs">{feature}</div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-3 pt-2">
          <Button asChild>
            <Link to="/billing">
              <CreditCard className="mr-2 h-4 w-4" />
              Voir les plans
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/pv">
              Retour aux PV existants
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>

        <p className="border-t pt-4 text-xs text-muted-foreground">
          L'accès en lecture à vos anciens PV reste disponible — seules les actions
          de création, signature et exports premium sont bloquées tant que l'abonnement
          n'est pas régularisé.
        </p>
      </Card>
    </div>
  );
}

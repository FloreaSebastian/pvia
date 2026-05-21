import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { AlertOctagon, CreditCard, ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { PageHeader } from "@/components/app/PageHeader";
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
    <div className="flex flex-col">
      <PageHeader
        eyebrow={<><AlertOctagon className="h-3 w-3" /> Abonnement</>}
        title={info.title}
        description={info.body}
      />
      <div className="mx-auto w-full max-w-2xl p-4 sm:p-6 lg:p-8">
        <Card className="space-y-5 border-destructive/40 p-8 shadow-brand">
          <div className="grid gap-3 rounded-lg border border-border/60 bg-muted/40 p-4 text-sm sm:grid-cols-2">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Plan actuel</div>
              <div className="mt-1 font-display font-bold">{limits?.display_name ?? plan}</div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">État</div>
              <div className="mt-1">
                <StatusPill tone="warning" dot>{access?.state ?? "inconnu"}</StatusPill>
              </div>
            </div>
            {feature && (
              <div className="sm:col-span-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Fonctionnalité bloquée</div>
                <div className="mt-1 font-mono text-xs">{feature}</div>
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

          <p className="border-t border-border/60 pt-4 text-xs text-muted-foreground">
            L'accès en lecture à vos anciens PV reste disponible — seules les actions
            de création, signature et exports premium sont bloquées tant que l'abonnement
            n'est pas régularisé.
          </p>
        </Card>
      </div>
    </div>
  );
}

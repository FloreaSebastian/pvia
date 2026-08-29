import { Link } from "@tanstack/react-router";
import { Lock, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useSubscription } from "@/hooks/use-subscription";
import { useBillingGate, subscriptionCopy } from "@/components/billing/BillingGate";
import type { PropsWithChildren } from "react";

type Feature = "remote_sign" | "advanced_stats" | "export_audit" | "branding" | "technical_visits";

const LABELS: Record<Feature, string> = {
  remote_sign: "Signature à distance",
  advanced_stats: "Statistiques avancées",
  export_audit: "Export de l'historique d'audit",
  branding: "Branding personnalisé",
  technical_visits: "Visite technique",
};

const FEATURE_COLUMN: Record<Feature, string> = {
  remote_sign: "can_remote_sign",
  advanced_stats: "can_advanced_stats",
  export_audit: "can_export_audit",
  branding: "can_branding",
  technical_visits: "can_technical_visits",
};

/** Plan minimum dérivé de `plan_limits` (source de vérité serveur). */
function minPlanFor(feature: Feature, allPlans: any[]): string | null {
  const col = FEATURE_COLUMN[feature];
  const eligible = (allPlans ?? [])
    .filter((p) => Boolean(p?.[col]))
    .sort((a, b) => (a?.sort_order ?? 0) - (b?.sort_order ?? 0));
  return eligible[0]?.display_name ?? null;
}


/**
 * Affiche les enfants si la formule active inclut `feature` ET que
 * l'abonnement autorise l'écriture. Sinon, carte explicative distinguant
 * clairement « abonnement à activer » et « fonctionnalité non incluse ».
 * UI seulement — les server functions appliquent la vraie garde.
 */
export function FeatureGate({
  feature,
  children,
  fallback,
}: PropsWithChildren<{ feature: Feature; fallback?: React.ReactNode }>) {
  const { hasFeature, blocked, access, isLoading } = useSubscription();
  const { openSubscription, openFeature } = useBillingGate();

  if (isLoading) return null;

  const allowed = hasFeature(feature) && !blocked;
  if (allowed) return <>{children}</>;
  if (fallback) return <>{fallback}</>;

  const copy = subscriptionCopy(access?.state);
  const minPlan = MIN_PLAN[feature];

  return (
    <Card className="flex flex-col items-start gap-3 border-dashed bg-muted/30 p-5 sm:p-6">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Lock className="h-4 w-4 shrink-0" aria-hidden />
        {blocked ? copy.title : LABELS[feature]}
      </div>
      <p className="text-sm text-muted-foreground">
        {blocked
          ? copy.body
          : `Cette fonctionnalité n'est pas incluse dans votre formule actuelle${
              minPlan ? ` — disponible à partir du plan ${minPlan}` : ""
            }.`}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm" className="min-h-[44px]">
          <Link to="/billing">
            <Sparkles className="mr-2 h-4 w-4" aria-hidden />
            {blocked ? copy.cta : "Changer de formule"}
          </Link>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="min-h-[44px]"
          onClick={() => (blocked ? openSubscription() : openFeature(LABELS[feature]))}
        >
          En savoir plus
        </Button>
      </div>
    </Card>
  );
}

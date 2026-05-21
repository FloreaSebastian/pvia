import { Link } from "@tanstack/react-router";
import { Lock, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useSubscription } from "@/hooks/use-subscription";
import type { PropsWithChildren } from "react";

type Feature = "remote_sign" | "advanced_stats" | "export_audit" | "branding";

const LABELS: Record<Feature, string> = {
  remote_sign: "Signature à distance",
  advanced_stats: "Statistiques avancées",
  export_audit: "Export de l'historique d'audit",
  branding: "Branding personnalisé",
};

/**
 * Renders children if the active plan grants `feature` AND the subscription is usable.
 * Otherwise renders an upgrade card. UI-only — server functions still enforce the gate.
 */
export function FeatureGate({
  feature,
  children,
  fallback,
}: PropsWithChildren<{ feature: Feature; fallback?: React.ReactNode }>) {
  const { hasFeature, blocked, access, isLoading } = useSubscription();

  if (isLoading) return null;

  const allowed = hasFeature(feature) && !blocked;
  if (allowed) return <>{children}</>;
  if (fallback) return <>{fallback}</>;

  const reason = blocked
    ? `Abonnement requis (${access?.state ?? "inactif"})`
    : `Disponible à partir d'un plan supérieur`;

  return (
    <Card className="flex flex-col items-start gap-3 border-dashed bg-muted/30 p-6">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Lock className="h-4 w-4" />
        {LABELS[feature]}
      </div>
      <p className="text-sm text-muted-foreground">{reason}</p>
      <Button asChild size="sm">
        <Link to="/billing">
          <Sparkles className="mr-2 h-4 w-4" />
          Mettre à niveau
        </Link>
      </Button>
    </Card>
  );
}

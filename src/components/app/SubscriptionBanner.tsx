import { Link } from "@tanstack/react-router";
import { AlertTriangle, Clock, Sparkles } from "lucide-react";
import { useSubscription } from "@/hooks/use-subscription";

function daysLeft(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

/**
 * Bannière globale d'abonnement :
 * - essai en cours → compte à rebours (mise en avant à ≤ 3 jours),
 * - accès restreint (essai expiré, impayé, résilié…) → mode lecture seule.
 * L'affichage est purement informatif : les écritures sont bloquées côté serveur.
 */
export function SubscriptionBanner() {
  const { access, blocked, isTrialing, isLoading } = useSubscription();
  if (isLoading || !access) return null;

  if (blocked) {
    return (
      <div className="flex flex-wrap items-center gap-3 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <span className="font-semibold">Accès restreint — lecture seule.</span>{" "}
          <span className="text-destructive/80">
            {access.state === "trial_expired"
              ? "Votre essai gratuit de 14 jours est terminé."
              : access.state === "past_due" || access.state === "unpaid"
                ? "Un problème de paiement bloque votre abonnement."
                : "Aucun abonnement actif sur ce compte."}
          </span>
        </div>
        <Link
          to="/billing"
          className="min-h-[36px] rounded-md border border-destructive/40 bg-background/60 px-3 py-1 font-medium text-destructive hover:bg-background"
        >
          Choisir un abonnement
        </Link>
      </div>
    );
  }

  if (isTrialing) {
    const d = daysLeft(access.trial_end);
    if (d === null) return null;
    const urgent = d <= 3;
    return (
      <div
        className={`flex flex-wrap items-center gap-3 border-b px-4 py-2 text-sm ${
          urgent
            ? "border-destructive/30 bg-destructive/10 text-destructive"
            : "border-primary/25 bg-primary/10 text-primary"
        }`}
      >
        {urgent ? <Clock className="h-4 w-4 shrink-0" /> : <Sparkles className="h-4 w-4 shrink-0" />}
        <div className="min-w-0 flex-1">
          <span className="font-semibold">
            Essai gratuit — {d === 0 ? "dernier jour" : `${d} jour${d > 1 ? "s" : ""} restant${d > 1 ? "s" : ""}`}.
          </span>{" "}
          <span className="opacity-80">Activez un abonnement pour continuer sans interruption.</span>
        </div>
        <Link
          to="/billing"
          className="min-h-[36px] rounded-md border border-current/30 bg-background/60 px-3 py-1 font-medium hover:bg-background"
        >
          Voir les formules
        </Link>
      </div>
    );
  }

  return null;
}

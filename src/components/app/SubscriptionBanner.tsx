import { Link } from "@tanstack/react-router";
import { AlertTriangle, Clock, Sparkles } from "lucide-react";
import { useSubscription } from "@/hooks/use-subscription";
import { useBillingGate, subscriptionCopy } from "@/components/billing/BillingGate";
import { formatFrDate } from "@/lib/plans";

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
 * Les textes proviennent de la même matrice que la popup centrale
 * (`subscriptionCopy`) : un seul discours dans toute l'application.
 */
export function SubscriptionBanner() {
  const { access, blocked, isTrialing, isLoading } = useSubscription();
  const { openSubscription } = useBillingGate();
  if (isLoading || !access) return null;

  if (blocked) {
    const copy = subscriptionCopy(access.state);
    return (
      <div className="flex flex-wrap items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive sm:gap-3 sm:px-4">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <span className="font-semibold">{copy.title} —</span>{" "}
          <span className="text-destructive/80">{copy.body}</span>
        </div>
        <button
          type="button"
          onClick={() => openSubscription()}
          className="min-h-[44px] rounded-md px-2 font-medium underline underline-offset-2 hover:bg-background/60"
        >
          En savoir plus
        </button>
        <Link
          to="/billing"
          className="inline-flex min-h-[44px] items-center rounded-md border border-destructive/40 bg-background/60 px-3 py-1 font-medium text-destructive hover:bg-background"
        >
          {copy.cta}
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
        className={`flex flex-wrap items-center gap-3 border-b px-3 py-2 text-sm sm:px-4 ${
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
          <span className="opacity-80">
            Fin de l'essai le {formatFrDate(access.trial_end)}. Activez une formule pour continuer sans interruption.
          </span>
        </div>
        <Link
          to="/billing"
          className="inline-flex min-h-[44px] items-center rounded-md border border-current/30 bg-background/60 px-3 py-1 font-medium hover:bg-background"
        >
          Voir les formules
        </Link>
      </div>
    );
  }

  return null;
}

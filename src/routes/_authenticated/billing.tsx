import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Check, Loader2, ExternalLink, CreditCard, AlertTriangle, Sparkles, Clock, AlertOctagon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { useSubscription } from "@/hooks/use-subscription";
import { useCompany } from "@/hooks/use-company";
import { createCheckoutSession, createPortalSession } from "@/lib/billing.functions";
import { getStripeEnvironment, PLAN_PRICE_IDS } from "@/lib/stripe";


export const Route = createFileRoute("/_authenticated/billing")({
  component: BillingPage,
  head: () => ({ meta: [{ title: "Facturation — PVIA" }] }),
});

function BillingPage() {
  const { activeCompanyId, activeRole } = useCompany();
  const { plan, limits, usage, subscription, allPlans, isLoading, refetch } = useSubscription();
  const checkoutFn = useServerFn(createCheckoutSession);
  const portalFn = useServerFn(createPortalSession);
  const [busy, setBusy] = useState<string | null>(null);

  const canManage = activeRole === "owner" || activeRole === "admin";
  const env = getStripeEnvironment();

  async function handleUpgrade(targetPlan: "starter" | "pro" | "enterprise") {
    if (!activeCompanyId) return;
    setBusy(targetPlan);
    try {
      const { url } = await checkoutFn({
        data: {
          companyId: activeCompanyId,
          priceId: PLAN_PRICE_IDS[targetPlan],
          environment: env,
          returnUrl: `${window.location.origin}/billing`,
        },
      });
      if (url) window.location.href = url;
    } catch (e: any) {
      toast.error(e.message || "Erreur lors de l'ouverture du paiement.");
    } finally {
      setBusy(null);
    }
  }

  async function handlePortal() {
    if (!activeCompanyId) return;
    setBusy("portal");
    try {
      const { url } = await portalFn({
        data: {
          companyId: activeCompanyId,
          environment: env,
          returnUrl: `${window.location.origin}/billing`,
        },
      });
      window.open(url, "_blank");
    } catch (e: any) {
      toast.error(e.message || "Erreur portail de facturation.");
    } finally {
      setBusy(null);
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const pvMax = limits?.max_pv_per_month;
  const membersMax = limits?.max_members;
  const pvPct = pvMax ? Math.min(100, (usage.pv_this_period / pvMax) * 100) : 0;
  const memPct = membersMax ? Math.min(100, (usage.members / membersMax) * 100) : 0;

  return (
    <div className="space-y-8 p-6 lg:p-8">
      {env === "sandbox" && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="mr-2 inline h-4 w-4" />
          Mode test Stripe actif. Utilisez la carte <code className="font-mono">4242 4242 4242 4242</code> (date future, CVC 123).
        </div>
      )}

      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Facturation & abonnement</h1>
        <p className="mt-1 text-muted-foreground">Plan actif, consommation, gestion de l'abonnement.</p>
      </div>

      {/* Current plan + usage */}
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Plan actuel</div>
            <div className="mt-1 flex items-center gap-3">
              <span className="text-3xl font-semibold">{limits?.display_name ?? plan}</span>
              <Badge variant={subscription?.status === "active" || subscription?.status === "trialing" ? "default" : "secondary"}>
                {subscription?.status ?? "free"}
              </Badge>
              {subscription?.cancel_at_period_end && (
                <Badge variant="destructive">Annulation prévue</Badge>
              )}
            </div>
            {subscription?.current_period_end && (
              <div className="mt-2 text-sm text-muted-foreground">
                Renouvellement le {new Date(subscription.current_period_end).toLocaleDateString("fr-FR")}
              </div>
            )}
          </div>
          {canManage && subscription?.stripe_customer_id && (
            <Button variant="outline" onClick={handlePortal} disabled={busy === "portal"}>
              {busy === "portal" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CreditCard className="mr-2 h-4 w-4" />}
              Gérer mon abonnement
              <ExternalLink className="ml-2 h-3 w-3" />
            </Button>
          )}
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div>
            <div className="mb-1 flex items-baseline justify-between text-sm">
              <span className="font-medium">PV ce mois-ci</span>
              <span className="text-muted-foreground">
                {usage.pv_this_period} / {pvMax ?? "∞"}
              </span>
            </div>
            <Progress value={pvPct} />
          </div>
          <div>
            <div className="mb-1 flex items-baseline justify-between text-sm">
              <span className="font-medium">Membres actifs</span>
              <span className="text-muted-foreground">
                {usage.members} / {membersMax ?? "∞"}
              </span>
            </div>
            <Progress value={memPct} />
          </div>
        </div>
      </Card>

      {/* Plans */}
      <div>
        <h2 className="mb-4 text-xl font-semibold">Changer de plan</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {allPlans.map((p: any) => {
            const isCurrent = p.plan === plan;
            const features = [
              p.max_pv_per_month == null ? "PV illimités" : `${p.max_pv_per_month} PV / mois`,
              p.max_members == null ? "Utilisateurs illimités" : `${p.max_members} utilisateur${p.max_members > 1 ? "s" : ""}`,
              p.can_remote_sign && "Signature à distance",
              p.can_advanced_stats && "Statistiques avancées",
              p.can_export_audit && "Export historique audit",
              p.can_branding && "Branding personnalisé",
            ].filter(Boolean) as string[];

            return (
              <Card key={p.plan} className={`p-6 ${isCurrent ? "border-primary ring-2 ring-primary/20" : ""}`}>
                <div className="flex items-baseline justify-between">
                  <div className="text-lg font-semibold">{p.display_name}</div>
                  {isCurrent && <Badge>Actuel</Badge>}
                </div>
                <div className="mt-2 text-3xl font-semibold">
                  {p.monthly_price_eur}€<span className="text-base font-normal text-muted-foreground">/mois</span>
                </div>
                <ul className="mt-4 space-y-2 text-sm">
                  {features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                {canManage && !isCurrent && (
                  <Button
                    className="mt-6 w-full"
                    onClick={() => handleUpgrade(p.plan)}
                    disabled={busy === p.plan}
                  >
                    {busy === p.plan ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    {subscription?.stripe_customer_id ? "Basculer" : "S'abonner"}
                  </Button>
                )}
              </Card>
            );
          })}
        </div>
        {!canManage && (
          <p className="mt-4 text-sm text-muted-foreground">
            Seuls les rôles owner/admin peuvent modifier l'abonnement.
          </p>
        )}
      </div>

      <div className="text-xs text-muted-foreground">
        Paiement sécurisé par Stripe. <button className="underline" onClick={() => refetch()}>Rafraîchir</button>
      </div>
    </div>
  );
}

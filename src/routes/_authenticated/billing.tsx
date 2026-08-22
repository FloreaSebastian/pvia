import { createFileRoute, Link } from "@tanstack/react-router";
import { ADMIN_ROLES, OWNER_ROLES, SIGN_ROLES, isAdminRole, isManageRole } from "@/lib/roles";
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
import { getStripeEnvironment } from "@/lib/stripe";
import {
  CONTACT_SALES_EMAIL,
  formatEur,
  type BillingInterval,
  type CheckoutPriceId,
} from "@/lib/plans";
import { PageHeader } from "@/components/app/PageHeader";


import { RouteRoleGuard } from "@/components/auth/RouteRoleGuard";

function GuardedBillingPage() {
  return (
    <RouteRoleGuard allow={OWNER_ROLES}>
      <BillingPage />
    </RouteRoleGuard>
  );
}


/** Filet de sécurité client : n'affiche jamais un message technique. */
const TECHNICAL_ERROR_RE =
  /cus_|sub_[A-Za-z0-9]{6,}|price_|prod_|cs_(test|live)_|whsec_|sk_(test|live)_|req_[A-Za-z0-9]{6,}|No such |StripeError|api\.stripe\.com|PGRST|service_role|supabase|jwt|ZodError|lookup_key/i;
function safeBillingMessage(e: unknown, fallback: string): string {
  const msg = e instanceof Error ? e.message : "";
  if (!msg || TECHNICAL_ERROR_RE.test(msg)) return fallback;
  return msg;
}

export const Route = createFileRoute("/_authenticated/billing")({
  component: GuardedBillingPage,
  head: () => ({ meta: [{ title: "Facturation — PVIA" }] }),
});

function BillingPage() {
  const { activeCompanyId, activeRole } = useCompany();
  const { plan, limits, usage, subscription, allPlans, access, isLoading, refetch } = useSubscription();

  const checkoutFn = useServerFn(createCheckoutSession);
  const portalFn = useServerFn(createPortalSession);
  const [busy, setBusy] = useState<string | null>(null);
  const [billingInterval, setBillingInterval] = useState<BillingInterval>("monthly");

  const canManage = isAdminRole(activeRole);
  const env = getStripeEnvironment();

  async function handleUpgrade(priceId: string) {
    if (!activeCompanyId || !priceId) return;
    setBusy(priceId);
    try {
      const { url } = await checkoutFn({
        data: {
          companyId: activeCompanyId,
          priceId: priceId as CheckoutPriceId,
          environment: env,
          returnUrl: `${window.location.origin}/billing`,
        },
      });
      if (url) window.location.href = url;
    } catch (e: any) {
      toast.error(safeBillingMessage(e, "Impossible de démarrer le paiement pour le moment. Réessayez dans quelques instants."));
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
      toast.error(safeBillingMessage(e, "Impossible d'ouvrir la gestion de votre abonnement pour le moment."));
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
    <div className="space-y-8 p-4 sm:p-6 lg:p-8">
      {env === "sandbox" && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning-foreground">
          <AlertTriangle className="mr-2 inline h-4 w-4" />
          Mode test Stripe actif. Utilisez la carte <code className="font-mono">4242 4242 4242 4242</code> (date future, CVC 123).
        </div>
      )}

      <PageHeader
        title="Facturation & abonnement"
        description="Plan actif, consommation, gestion de l'abonnement."
        contained={false}
        className="border-0 bg-transparent px-0 py-0"
      />

      {access?.blocked && (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <AlertOctagon className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <div className="flex-1">
            <div className="font-medium text-destructive">Abonnement requis ({access.state})</div>
            <p className="mt-0.5 text-muted-foreground">
              Création PV, signatures distantes, exports et invitations sont bloqués
              tant que l'abonnement n'est pas régularisé. La lecture des anciens PV reste possible.
            </p>
            <Button asChild size="sm" className="mt-3 min-h-[44px]">
              <Link to="/upgrade-required" search={{ reason: access.state }}>Voir les options</Link>
            </Button>
          </div>
        </div>
      )}


      {/* Current plan + usage */}
      <Card className="relative overflow-hidden p-6">
        <div className="pointer-events-none absolute inset-0 -z-0 opacity-60 bg-[radial-gradient(circle_at_top_right,oklch(var(--primary)/0.12),transparent_55%)]" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Plan actuel</div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="bg-brand-gradient bg-clip-text text-3xl font-semibold tracking-tight text-transparent">
                {limits?.display_name ?? plan}
              </span>
              <Badge variant={access?.state === "active" || access?.state === "trialing" ? "default" : "secondary"}>
                {access?.state ?? subscription?.status ?? "free"}
              </Badge>
              {access?.state === "trialing" && (
                <Badge className="bg-success text-success-foreground hover:bg-success/90"><Sparkles className="mr-1 h-3 w-3" />Essai actif</Badge>
              )}
              {subscription?.cancel_at_period_end && (
                <Badge variant="destructive">Annulation prévue</Badge>
              )}
            </div>
            {access?.trial_end && access.state === "trialing" && (
              <div className="mt-2 flex items-center gap-1.5 text-sm text-success">
                <Clock className="h-3.5 w-3.5" />
                Fin de l'essai gratuit le {new Date(access.trial_end).toLocaleDateString("fr-FR")}
              </div>
            )}
            {subscription?.current_period_end && access?.state !== "trialing" && (
              <div className="mt-2 text-sm text-muted-foreground">
                {subscription.cancel_at_period_end ? "Accès jusqu'au" : "Renouvellement le"} {new Date(subscription.current_period_end).toLocaleDateString("fr-FR")}
              </div>
            )}
          </div>

          {canManage && subscription?.stripe_customer_id && (
            <Button variant="outline" onClick={handlePortal} disabled={busy === "portal"} className="min-h-[44px] shadow-sm">
              {busy === "portal" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CreditCard className="mr-2 h-4 w-4" />}
              Gérer mon abonnement
              <ExternalLink className="ml-2 h-3 w-3" />
            </Button>
          )}
        </div>

        <div className="relative mt-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-border bg-card/60 p-4">
            <div className="mb-2 flex items-baseline justify-between text-sm">
              <span className="font-medium">PV ce mois-ci</span>
              <span className="tabular-nums text-muted-foreground">
                {usage.pv_this_period} / {pvMax ?? "∞"}
              </span>
            </div>
            <Progress value={pvPct} />
          </div>
          <div className="rounded-xl border border-border bg-card/60 p-4">
            <div className="mb-2 flex items-baseline justify-between text-sm">
              <span className="font-medium">Membres actifs</span>
              <span className="tabular-nums text-muted-foreground">
                {usage.members} / {membersMax ?? "∞"}
              </span>
            </div>
            <Progress value={memPct} />
          </div>
        </div>
      </Card>

      {/* Plans */}
      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-tight">Changer de plan</h2>
          <div
            role="group"
            aria-label="Périodicité de facturation"
            className="inline-flex rounded-full border border-border bg-muted/40 p-1"
          >
            {(["monthly", "annual"] as const).map((i) => (
              <button
                key={i}
                type="button"
                onClick={() => setBillingInterval(i)}
                aria-pressed={billingInterval === i}
                className={`min-h-[44px] rounded-full px-4 text-sm font-medium transition ${
                  billingInterval === i
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {i === "monthly" ? "Mensuel" : "Annuel"}
                {i === "annual" && (
                  <span className="ml-1.5 text-xs font-semibold text-success">−2 mois</span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {allPlans.map((p: any) => {
            const isCurrent = p.plan === plan;
            const custom = Boolean(p.is_custom_pricing);
            const recommended = Boolean(p.recommended);
            const priceId = billingInterval === "annual" ? p.stripe_price_annual : p.stripe_price_monthly;
            const amount = billingInterval === "annual" ? p.annual_price_eur : p.monthly_price_eur;
            const seatsBlocked =
              p.max_members != null && (usage.seats ?? usage.members) > p.max_members;
            const features = [
              p.max_members == null
                ? "Utilisateurs illimités"
                : `${p.max_members} utilisateur${p.max_members > 1 ? "s" : ""}`,
              p.max_pv_per_month == null ? "PV illimités" : `${p.max_pv_per_month} PV / mois`,
              p.can_remote_sign && "Signature à distance",
              p.can_advanced_stats && "Statistiques avancées",
              p.can_export_audit && "Export historique audit",
              p.can_branding && "Branding personnalisé",
            ].filter(Boolean) as string[];

            return (
              <Card
                key={p.plan}
                className={`relative flex flex-col p-6 transition hover:-translate-y-0.5 hover:shadow-brand ${
                  isCurrent ? "border-primary/60 ring-2 ring-primary/20" : ""
                } ${recommended && !isCurrent ? "border-primary/30" : ""}`}
              >
                {recommended && !isCurrent && (
                  <div className="absolute -top-2.5 right-4 rounded-full bg-brand-gradient px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary-foreground shadow-brand">
                    Recommandé
                  </div>
                )}
                <div className="flex items-baseline justify-between gap-2">
                  <div className="text-lg font-semibold tracking-tight">{p.display_name}</div>
                  {isCurrent && <Badge>Actuel</Badge>}
                </div>
                {p.tagline && (
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{p.tagline}</p>
                )}
                <div className="mt-3 text-3xl font-semibold tracking-tight">
                  {custom || amount == null ? (
                    <span className="text-2xl">Sur devis</span>
                  ) : (
                    <>
                      {formatEur(amount)}
                      <span className="text-base font-normal text-muted-foreground">
                        {billingInterval === "annual" ? " / an HT" : " / mois HT"}
                      </span>
                    </>
                  )}
                </div>
                <ul className="mt-5 flex-1 space-y-2 text-sm">
                  {features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-success/15 text-success">
                        <Check className="h-2.5 w-2.5" />
                      </span>
                      <span className="min-w-0 break-words">{f}</span>
                    </li>
                  ))}
                </ul>

                {canManage && !isCurrent && custom && (
                  <Button variant="outline" className="mt-6 min-h-[44px] w-full" asChild>
                    <a href={`mailto:${CONTACT_SALES_EMAIL}?subject=Demande%20offre%20Entreprise%20PVIA`}>
                      Nous contacter
                    </a>
                  </Button>
                )}

                {canManage && !isCurrent && !custom && (
                  <>
                    <Button
                      className={`mt-6 min-h-[44px] w-full ${recommended ? "shadow-brand" : ""}`}
                      variant={recommended ? "default" : "outline"}
                      onClick={() => handleUpgrade(priceId)}
                      disabled={busy === priceId || seatsBlocked || !priceId}
                    >
                      {busy === priceId ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      {subscription?.stripe_customer_id ? "Basculer" : "S'abonner"}
                    </Button>
                    {seatsBlocked && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Trop d'utilisateurs actifs ({usage.seats ?? usage.members}) pour ce plan.
                      </p>
                    )}
                  </>
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
        Paiement sécurisé par Stripe.{" "}
        <button
          type="button"
          className="inline-flex min-h-[44px] items-center px-2 underline"
          onClick={() => refetch()}
        >
          Rafraîchir
        </button>
      </div>
    </div>
  );
}

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Fragment } from "react";
import { ADMIN_ROLES, isAdminRole } from "@/lib/roles";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Minus,
  Loader2,
  ExternalLink,
  CreditCard,
  AlertTriangle,
  Sparkles,
  Clock,
  AlertOctagon,
  ReceiptText,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
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
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useSubscription } from "@/hooks/use-subscription";
import { useCompany } from "@/hooks/use-company";
import { createCheckoutSession, createPortalSession, syncSubscriptionFromStripe } from "@/lib/billing.functions";
import { getStripeEnvironment } from "@/lib/stripe";
import {
  CONTACT_SALES_EMAIL,
  COMPARISON,
  accessStateLabel,
  accessStateHelp,

  annualSavingEur,
  daysUntil,
  formatEur,
  formatFrDate,
  type BillingInterval,
  type CheckoutPriceId,
  type PlanLimitsRow,
} from "@/lib/plans";
import { PageHeader } from "@/components/app/PageHeader";
import { RouteRoleGuard } from "@/components/auth/RouteRoleGuard";

function GuardedBillingPage() {
  return (
    <RouteRoleGuard allow={ADMIN_ROLES}>
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
  validateSearch: (s: { status?: string; session_id?: string }) => ({
    status: typeof s.status === "string" ? s.status : undefined,
    session_id: typeof s.session_id === "string" ? s.session_id : undefined,
  }),
  head: () => ({ meta: [{ title: "Facturation & abonnement — PVIA" }] }),
});


/** Baseline commerciale : ce que chaque formule apporte de plus. */
const PLAN_PITCH: Record<string, string> = {
  starter: "Je réalise mes réceptions de travaux.",
  pro: "Je gère le chantier de la visite technique jusqu'à la réception.",
  business: "Je pilote plusieurs équipes et un volume important de chantiers.",
  enterprise: "J'adapte PVIA à mon organisation.",
};

/** Liste d'arguments dérivée des flags réels de `plan_limits`. */
function planFeatures(p: PlanLimitsRow, index: number, plans: PlanLimitsRow[]): string[] {
  const previous = index > 0 ? plans[index - 1] : null;
  return [
    p.max_members == null
      ? "Utilisateurs illimités"
      : `Jusqu'à ${p.max_members} utilisateur${p.max_members > 1 ? "s" : ""}`,
    p.max_pv_per_month == null ? "PV illimités" : `${p.max_pv_per_month} PV de réception / mois`,
    previous ? `Tout ${previous.display_name}` : "Chantiers, clients, photos et réserves",
    p.can_technical_visits
      ? "Visites techniques (PV, PAC air/air, air/eau)"
      : null,
    p.can_technical_visits ? "Création automatique du chantier depuis la visite" : null,
    p.can_remote_sign ? "Signature client à distance" : "Signature sur site",
    "Espace client et levées de réserves",
    p.can_advanced_stats ? "Statistiques avancées" : null,
    p.can_export_audit ? "Export de l'historique et de l'audit" : null,
    p.can_branding ? "Branding personnalisé" : null,
    p.is_custom_pricing ? "Accompagnement au déploiement et support prioritaire" : null,
  ].filter(Boolean) as string[];
}

function UsageTile({
  label,
  used,
  max,
  unlimited,
}: {
  label: string;
  used: number;
  max: number | null;
  unlimited?: boolean;
}) {
  const isUnlimited = unlimited || max == null;
  const pct = isUnlimited || !max ? 0 : Math.min(100, (used / max) * 100);
  return (
    <div className="min-w-0 rounded-xl border border-border bg-card/60 p-4">
      <div className="mb-2 flex items-baseline justify-between gap-2 text-sm">
        <span className="min-w-0 truncate font-medium">{label}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {isUnlimited ? `${used} · Illimité` : `${used} / ${max}`}
        </span>
      </div>
      {!isUnlimited && <Progress value={pct} />}
    </div>
  );
}

function Cell({ value }: { value: boolean | string }) {
  if (value === true)
    return (
      <span className="inline-flex items-center gap-1 text-success">
        <Check className="h-4 w-4" aria-hidden />
        <span className="sr-only">Inclus</span>
      </span>
    );
  if (value === false)
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground/60">
        <Minus className="h-4 w-4" aria-hidden />
        <span className="sr-only">Non inclus</span>
      </span>
    );
  return <span className="text-xs font-medium tabular-nums">{value}</span>;
}

function BillingPage() {
  const { activeCompanyId, activeRole } = useCompany();
  const { plan, limits, usage, subscription, allPlans, access, isLoading, refetch } = useSubscription();

  const checkoutFn = useServerFn(createCheckoutSession);
  const portalFn = useServerFn(createPortalSession);
  const syncFn = useServerFn(syncSubscriptionFromStripe);
  const search = Route.useSearch();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [billingInterval, setBillingInterval] = useState<BillingInterval>("monthly");
  const [pendingDowngrade, setPendingDowngrade] = useState<{ priceId: string; target: PlanLimitsRow } | null>(null);
  const [syncing, setSyncing] = useState(false);

  const canManage = isAdminRole(activeRole);
  const env = getStripeEnvironment();

  // Retour de Checkout / Portail : on ne dépend pas du délai webhook.
  // On resynchronise depuis Stripe puis on invalide le cache React Query
  // (clé ["billing", activeCompanyId]) : l'utilisateur retrouve l'écriture
  // immédiatement, sans déconnexion/reconnexion.
  const syncedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeCompanyId || !canManage) return;
    const marker = `${activeCompanyId}:${search.session_id ?? search.status ?? ""}`;
    if (!search.status || syncedRef.current === marker) return;
    syncedRef.current = marker;
    let cancelled = false;
    (async () => {
      setSyncing(true);
      try {
        if (search.status === "success") {
          await syncFn({ data: { companyId: activeCompanyId, environment: env } });
        }
      } catch {
        /* la resynchro reste best-effort : le webhook fera foi */
      } finally {
        await queryClient.invalidateQueries({ queryKey: ["billing", activeCompanyId] });
        if (!cancelled) {
          setSyncing(false);
          if (search.status === "success") toast.success("Abonnement mis à jour.");
          void navigate({ to: "/billing", search: () => ({}), replace: true });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeCompanyId, canManage, env, search.status, search.session_id, syncFn, queryClient, navigate]);


  const plans = (allPlans ?? []) as PlanLimitsRow[];
  const current = (limits as PlanLimitsRow | null) ?? null;
  const seatsUsed = usage.seats ?? usage.members;

  const currentIndex = useMemo(() => plans.findIndex((p) => p.plan === plan), [plans, plan]);

  async function startCheckout(priceId: string) {
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
      toast.error(
        safeBillingMessage(e, "Impossible de démarrer le paiement pour le moment. Réessayez dans quelques instants."),
      );
    } finally {
      setBusy(null);
    }
  }

  function handleSelect(priceId: string, target: PlanLimitsRow) {
    const targetIndex = plans.findIndex((p) => p.plan === target.plan);
    const isDowngrade = currentIndex >= 0 && targetIndex >= 0 && targetIndex < currentIndex;
    const seatsOverflow = target.max_members != null && seatsUsed > target.max_members;
    if (isDowngrade || seatsOverflow) {
      setPendingDowngrade({ priceId, target });
      return;
    }
    void startCheckout(priceId);
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

  const isTrial = access?.state === "trialing";
  const trialDaysLeft = daysUntil(access?.trial_end);
  const priceNow =
    billingInterval === "annual" ? current?.annual_price_eur : current?.monthly_price_eur;
  const hasSubscription = Boolean(subscription?.stripe_customer_id);

  return (
    <div className="space-y-8 overflow-x-hidden p-4 sm:p-6 lg:p-8">
      {env === "sandbox" && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning-foreground">
          <AlertTriangle className="mr-2 inline h-4 w-4" />
          Mode test Stripe actif. Utilisez la carte <code className="font-mono">4242 4242 4242 4242</code> (date future,
          CVC 123).
        </div>
      )}

      <PageHeader
        title="Facturation & abonnement"
        description="Gérez votre formule, votre consommation et votre facturation PVIA."
        contained={false}
        className="border-0 bg-transparent px-0 py-0"
      />

      {access?.blocked && (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <AlertOctagon className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <div className="font-medium text-destructive">{accessStateLabel(access.state)}</div>
            <p className="mt-0.5 text-muted-foreground">{accessStateHelp(access.state)}</p>
            <Button asChild size="sm" className="mt-3 min-h-[44px]">
              <Link to="/upgrade-required" search={{ reason: access.state }}>
                Voir les options
              </Link>
            </Button>
          </div>
        </div>
      )}

      {/* ---------------------- Votre abonnement ---------------------- */}
      <Card className="relative overflow-hidden p-5 sm:p-6">
        <div className="pointer-events-none absolute inset-0 -z-0 opacity-60 bg-[radial-gradient(circle_at_top_right,oklch(var(--primary)/0.12),transparent_55%)]" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Votre abonnement</div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="bg-brand-gradient bg-clip-text text-2xl font-semibold tracking-tight text-transparent sm:text-3xl">
                {access?.blocked
                  ? "Aucune formule active"
                  : isTrial
                    ? `Essai ${current?.display_name ?? "PVIA"}`
                    : (current?.display_name ?? "Formule")}
              </span>
              <Badge variant={access?.state === "active" || isTrial ? "default" : "destructive"}>
                {isTrial && trialDaysLeft != null
                  ? `Essai gratuit — ${trialDaysLeft} jour${trialDaysLeft > 1 ? "s" : ""} restant${trialDaysLeft > 1 ? "s" : ""}`
                  : accessStateLabel(access?.state)}
              </Badge>
              {subscription?.cancel_at_period_end && <Badge variant="secondary">Annulation prévue</Badge>}
            </div>

            {access?.blocked ? (
              <div className="mt-1 text-sm text-muted-foreground">{accessStateHelp(access.state)}</div>
            ) : current?.is_custom_pricing ? (
              <div className="mt-1 text-sm text-muted-foreground">Tarification sur devis</div>
            ) : subscription && priceNow != null ? (
              <div className="mt-1 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{formatEur(priceNow)} HT</span>
                {billingInterval === "annual" ? " / an · Facturation annuelle" : " / mois · Facturation mensuelle"}
              </div>
            ) : isTrial && priceNow != null ? (
              <div className="mt-1 text-sm text-muted-foreground">
                Essai gratuit en cours · tarif à l'issue de l'essai :{" "}
                <span className="font-medium text-foreground">{formatEur(priceNow)} HT</span>
                {billingInterval === "annual" ? " / an" : " / mois"}
              </div>
            ) : (
              <div className="mt-1 text-sm text-muted-foreground">
                Choisissez une formule ci-dessous pour activer votre abonnement.
              </div>
            )}


            {isTrial && (
              <div className="mt-3 rounded-lg border border-success/30 bg-success/5 p-3 text-sm">
                <div className="flex items-center gap-1.5 font-medium text-success">
                  <Sparkles className="h-4 w-4" />
                  Essai {current?.display_name ?? "PVIA"}
                  {trialDaysLeft != null && ` — ${trialDaysLeft} jour${trialDaysLeft > 1 ? "s" : ""} restant${trialDaysLeft > 1 ? "s" : ""}`}
                </div>
                <p className="mt-0.5 text-muted-foreground">
                  Votre essai se termine le {formatFrDate(access?.trial_end)}.
                </p>
              </div>
            )}

            {subscription?.current_period_end && !isTrial && (
              <div className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                {subscription.cancel_at_period_end ? "Accès jusqu'au" : "Prochaine facturation :"}{" "}
                {formatFrDate(subscription.current_period_end)}
              </div>
            )}
          </div>

          {canManage && hasSubscription && (
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              <Button
                variant="outline"
                onClick={handlePortal}
                disabled={busy === "portal"}
                className="min-h-[44px] shadow-sm"
              >
                {busy === "portal" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CreditCard className="mr-2 h-4 w-4" />
                )}
                Gérer mon abonnement
                <ExternalLink className="ml-2 h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                onClick={handlePortal}
                disabled={busy === "portal"}
                className="min-h-[44px]"
              >
                <ReceiptText className="mr-2 h-4 w-4" />
                Voir mes factures
              </Button>
            </div>
          )}
        </div>

        <div className="relative mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <UsageTile label="PV ce mois-ci" used={usage.pv_this_period} max={current?.max_pv_per_month ?? null} />
          <UsageTile label="Utilisateurs" used={seatsUsed} max={current?.max_members ?? null} />
          <div className="min-w-0 rounded-xl border border-border bg-card/60 p-4">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="min-w-0 truncate font-medium">Visites techniques</span>
              <span className={`shrink-0 ${current?.can_technical_visits ? "text-success" : "text-muted-foreground"}`}>
                {current?.can_technical_visits ? "Incluses" : "Non incluses"}
              </span>
            </div>
            {!current?.can_technical_visits && (
              <p className="mt-1 text-xs text-muted-foreground">Disponibles à partir du plan Pro.</p>
            )}
          </div>
        </div>
      </Card>

      {/* ---------------------------- Formules ---------------------------- */}
      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-tight">Changer de formule</h2>
          <div
            role="group"
            aria-label="Périodicité de facturation"
            className="inline-flex max-w-full rounded-full border border-border bg-muted/40 p-1"
          >
            {(["monthly", "annual"] as const).map((i) => (
              <button
                key={i}
                type="button"
                onClick={() => setBillingInterval(i)}
                aria-pressed={billingInterval === i}
                className={`min-h-[44px] rounded-full px-3 text-sm font-medium transition sm:px-4 ${
                  billingInterval === i
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {i === "monthly" ? "Mensuel" : "Annuel"}
                {i === "annual" && (
                  <span className="ml-1.5 hidden text-xs font-semibold text-success sm:inline">2 mois offerts</span>
                )}
              </button>
            ))}
          </div>
        </div>
        {billingInterval === "annual" && (
          <p className="mb-4 text-sm text-muted-foreground">Soit 2 mois offerts avec la facturation annuelle.</p>
        )}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {plans.map((p, index) => {
            const isCurrent = p.plan === plan;
            const custom = Boolean(p.is_custom_pricing);
            const recommended = Boolean(p.recommended);
            const priceId = billingInterval === "annual" ? p.stripe_price_annual : p.stripe_price_monthly;
            const amount = billingInterval === "annual" ? p.annual_price_eur : p.monthly_price_eur;
            const saving = annualSavingEur(p.monthly_price_eur, p.annual_price_eur);
            const features = planFeatures(p, index, plans);
            const targetIndex = index;
            const isDowngrade = currentIndex >= 0 && targetIndex < currentIndex;

            return (
              <Card
                key={p.plan}
                className={`relative flex min-w-0 flex-col p-5 transition hover:-translate-y-0.5 hover:shadow-brand sm:p-6 ${
                  isCurrent ? "border-primary/60 ring-2 ring-primary/20" : recommended ? "border-primary/30" : ""
                }`}
              >
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {recommended && (
                    <span className="rounded-full bg-brand-gradient px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary-foreground shadow-brand">
                      Recommandé
                    </span>
                  )}
                  {isCurrent && (
                    <span className="rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                      Plan actuel
                    </span>
                  )}
                </div>

                <div className="text-lg font-semibold tracking-tight">{p.display_name}</div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {p.tagline ?? PLAN_PITCH[p.plan] ?? ""}
                </p>

                <div className="mt-3">
                  <div className="text-2xl font-semibold tracking-tight sm:text-3xl">
                    {custom || amount == null ? (
                      <span className="text-2xl">Sur devis</span>
                    ) : (
                      <>
                        <span className="break-words">{formatEur(amount)}</span>
                        <span className="text-sm font-normal text-muted-foreground">
                          {billingInterval === "annual" ? " HT / an" : " HT / mois"}
                        </span>
                      </>
                    )}
                  </div>
                  {billingInterval === "annual" && saving && p.monthly_price_eur != null && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      au lieu de {formatEur(p.monthly_price_eur * 12)} ·{" "}
                      <span className="font-semibold text-success">{formatEur(saving)} économisés</span>
                    </div>
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

                {isCurrent && (
                  <Button className="mt-6 min-h-[44px] w-full" variant="outline" disabled>
                    Plan actuel
                  </Button>
                )}

                {canManage && !isCurrent && custom && (
                  <Button variant="outline" className="mt-6 min-h-[44px] w-full" asChild>
                    <a href={`mailto:${CONTACT_SALES_EMAIL}?subject=Demande%20offre%20Entreprise%20PVIA`}>
                      Nous contacter
                    </a>
                  </Button>
                )}

                {canManage && !isCurrent && !custom && (
                  <Button
                    className={`mt-6 min-h-[44px] w-full ${recommended ? "shadow-brand" : ""}`}
                    variant={recommended ? "default" : "outline"}
                    onClick={() => handleSelect(priceId ?? "", p)}
                    disabled={busy === priceId || !priceId}
                  >
                    {busy === priceId ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    {isDowngrade ? `Revenir à ${p.display_name}` : `Passer à ${p.display_name}`}
                  </Button>
                )}
              </Card>
            );
          })}
        </div>
        {!canManage && (
          <p className="mt-4 text-sm text-muted-foreground">
            Seuls les rôles direction / responsable d'exploitation peuvent modifier l'abonnement.
          </p>
        )}
      </div>

      {/* ------------------------- Comparaison ------------------------- */}
      <section aria-labelledby="comparaison">
        <h2 id="comparaison" className="mb-4 text-xl font-semibold tracking-tight">
          Comparez les formules
        </h2>
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th
                    scope="col"
                    className="sticky left-0 z-10 bg-muted/95 px-3 py-3 text-left font-semibold backdrop-blur sm:px-4"
                  >
                    Fonctionnalité
                  </th>
                  {plans.map((p) => (
                    <th key={p.plan} scope="col" className="px-2 py-3 text-center font-semibold sm:px-3">
                      {p.display_name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map((section) => (
                  <Fragment key={section.title}>
                    <tr className="border-b border-border/60 bg-muted/20">
                      <th
                        scope="colgroup"
                        colSpan={plans.length + 1}
                        className="sticky left-0 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground sm:px-4"
                      >
                        {section.title}
                      </th>
                    </tr>
                    {section.rows.map((row) => (
                      <tr key={`${section.title}-${row.label}`} className="border-b border-border/40 last:border-0">
                        <th
                          scope="row"
                          className="sticky left-0 z-10 bg-card px-3 py-2.5 text-left font-normal sm:px-4"
                        >
                          {row.label}
                        </th>
                        {plans.map((p) => (
                          <td key={p.plan} className="px-2 py-2.5 text-center sm:px-3">
                            <Cell value={row.value(p)} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <p className="mt-2 text-xs text-muted-foreground">
          Faites défiler le tableau horizontalement sur mobile — la colonne des fonctionnalités reste visible.
        </p>
      </section>

      <div className="text-xs text-muted-foreground">
        Paiement sécurisé par Stripe.{" "}
        <button type="button" className="inline-flex min-h-[44px] items-center px-2 underline" onClick={() => refetch()}>
          Rafraîchir
        </button>
      </div>

      {/* --------------------- Confirmation downgrade --------------------- */}
      <AlertDialog open={!!pendingDowngrade} onOpenChange={(o) => !o && setPendingDowngrade(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Cette formule autorise{" "}
              {pendingDowngrade?.target.max_members == null
                ? "un nombre illimité d'utilisateurs"
                : `${pendingDowngrade?.target.max_members} utilisateur${(pendingDowngrade?.target.max_members ?? 0) > 1 ? "s" : ""}`}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  Votre entreprise possède actuellement {seatsUsed} utilisateur{seatsUsed > 1 ? "s" : ""} actif
                  {seatsUsed > 1 ? "s" : ""} (invitations en attente incluses). Vous devrez adapter votre équipe pour
                  utiliser la formule {pendingDowngrade?.target.display_name}.
                </p>
                {pendingDowngrade && !pendingDowngrade.target.can_technical_visits && (
                  <p>Les visites techniques ne seront plus créables : les visites existantes restent consultables.</p>
                )}
                <p>Aucune donnée historique (PV, réserves, photos, documents) n'est supprimée lors d'un changement de formule.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-[44px]">Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="min-h-[44px]"
              onClick={() => {
                const p = pendingDowngrade;
                setPendingDowngrade(null);
                if (p) void startCheckout(p.priceId);
              }}
            >
              Continuer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

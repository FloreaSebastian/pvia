import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  getAdminBillingKpis,
  listAdminSubscriptions,
  adminRefreshCompanyBilling,
} from "@/lib/admin-billing.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/billing")({
  component: Page,
  head: () => ({
    meta: [
      { title: "Admin · Facturation plateforme — PVIA" },
      {
        name: "description",
        content:
          "Cockpit facturation PVIA : MRR/ARR hors taxes, abonnements, essais et paiements en échec.",
      },
      { property: "og:title", content: "Admin · Facturation plateforme — PVIA" },
      {
        property: "og:description",
        content: "MRR/ARR HT, abonnements et suivi des paiements PVIA.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  beforeLoad: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw redirect({ to: "/login" });
    const { isPlatformAdminEmail } = await import("@/lib/platform-admin");
    if (!isPlatformAdminEmail(user.email)) throw redirect({ to: "/admin/forbidden" });
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "platform_admin")
      .maybeSingle();
    if (!data) throw redirect({ to: "/admin/forbidden" });
  },
});

const STATUS_FILTERS = [
  { key: "trialing", label: "Essai" },
  { key: "active", label: "Actif" },
  { key: "past_due", label: "Impayé" },
  { key: "unpaid", label: "Non payé" },
  { key: "canceled", label: "Résilié" },
] as const;

const PLAN_FILTERS = ["starter", "pro", "business"] as const;

const STATUS_LABEL: Record<string, string> = {
  trialing: "Essai",
  active: "Actif",
  past_due: "Impayé",
  unpaid: "Non payé",
  canceled: "Résilié",
  paused: "Suspendu",
  incomplete: "Incomplet",
  incomplete_expired: "Expiré",
};

const euro = (n: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n ?? 0);
const date = (v?: string | null) =>
  v ? new Date(v).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" }) : "—";

function Kpi({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <Card className="border-zinc-800 bg-zinc-900 p-4">
      <div className="text-xs uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-zinc-100">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-zinc-500">{sub}</div>}
    </Card>
  );
}

function Page() {
  const kpiFn = useServerFn(getAdminBillingKpis);
  const listFn = useServerFn(listAdminSubscriptions);
  const refreshFn = useServerFn(adminRefreshCompanyBilling);
  const queryClient = useQueryClient();

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statuses, setStatuses] = useState<string[]>([]);
  const [plans, setPlans] = useState<string[]>([]);
  const [interval, setInterval] = useState<"monthly" | "annual" | null>(null);
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);
  const pageSize = 25;

  const kpis = useQuery({ queryKey: ["admin-billing-kpis"], queryFn: () => kpiFn({ data: {} } as never) });

  const listKey = useMemo(
    () => ["admin-subscriptions", { page, search, statuses, plans, interval }] as const,
    [page, search, statuses, plans, interval],
  );
  const list = useQuery({
    queryKey: listKey,
    queryFn: () =>
      listFn({
        data: {
          page,
          pageSize,
          ...(search ? { search } : {}),
          ...(statuses.length ? { status: statuses } : {}),
          ...(plans.length ? { plan: plans } : {}),
          ...(interval ? { interval } : {}),
        },
      } as never),
  });

  function toggle(set: (v: any) => void, current: string[], value: string) {
    setPage(1);
    set(current.includes(value) ? current.filter((v) => v !== value) : [...current, value]);
  }

  async function onRefresh(companyId: string) {
    setBusyId(companyId);
    try {
      await refreshFn({ data: { companyId } });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-subscriptions"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-billing-kpis"] }),
      ]);
      toast.success("État relu depuis Stripe.");
    } catch (e: any) {
      toast.error(e?.message ?? "Relecture impossible.");
    } finally {
      setBusyId(null);
    }
  }

  const k: any = kpis.data;
  const rows: any[] = (list.data as any)?.rows ?? [];
  const total: number = (list.data as any)?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="min-w-0">
      <h1 className="mb-1 text-2xl font-bold text-zinc-100">Facturation plateforme</h1>
      <p className="mb-6 text-sm text-zinc-400">
        MRR/ARR hors taxes, abonnements, essais et incidents de paiement. Lecture seule : aucune
        action ne modifie Stripe.
      </p>

      {kpis.isLoading || !k ? (
        <div className="grid place-items-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="MRR (HT)" value={euro(k.mrr_ht_eur)} sub="active + impayés, annuel ÷ 12" />
            <Kpi label="ARR (HT)" value={euro(k.arr_ht_eur)} sub="MRR × 12" />
            <Kpi label="Abonnements actifs" value={k.counts.subscriptions_active} />
            <Kpi label="Essais en cours" value={k.counts.trials_active} />
            <Kpi label="Starter / Pro / Business" value={`${k.counts.starter_active} / ${k.counts.pro_active} / ${k.counts.business_active}`} />
            <Kpi label="Résiliations programmées" value={k.counts.cancel_scheduled} />
            <Kpi label="Paiements en échec" value={k.counts.past_due + k.counts.unpaid} />
            <Kpi
              label="Essais expirés sans abo"
              value={k.counts.trials_expired_without_subscription}
              sub={`${k.counts.companies} entreprises au total`}
            />
          </div>
          <p className="mt-2 text-xs text-zinc-600">{k.definition}</p>
        </>
      )}

      {/* Filtres */}
      <Card className="mt-6 border-zinc-800 bg-zinc-900 p-4">
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-center"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setSearch(searchInput.trim());
          }}
        >
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Entreprise, e-mail ou Stripe Customer ID"
              aria-label="Rechercher une entreprise"
              className="min-h-[44px] pl-9"
            />
          </div>
          <Button type="submit" className="min-h-[44px]">Rechercher</Button>
        </form>

        <div className="mt-3 flex flex-wrap gap-2">
          {STATUS_FILTERS.map((s) => (
            <Button
              key={s.key}
              type="button"
              size="sm"
              variant={statuses.includes(s.key) ? "default" : "outline"}
              onClick={() => toggle(setStatuses, statuses, s.key)}
            >
              {s.label}
            </Button>
          ))}
          <span className="mx-1 h-8 w-px bg-zinc-800" aria-hidden />
          {PLAN_FILTERS.map((p) => (
            <Button
              key={p}
              type="button"
              size="sm"
              variant={plans.includes(p) ? "default" : "outline"}
              onClick={() => toggle(setPlans, plans, p)}
            >
              {p}
            </Button>
          ))}
          <span className="mx-1 h-8 w-px bg-zinc-800" aria-hidden />
          {(["monthly", "annual"] as const).map((i) => (
            <Button
              key={i}
              type="button"
              size="sm"
              variant={interval === i ? "default" : "outline"}
              onClick={() => {
                setPage(1);
                setInterval(interval === i ? null : i);
              }}
            >
              {i === "monthly" ? "Mensuel" : "Annuel"}
            </Button>
          ))}
        </div>
      </Card>

      {/* Tableau */}
      <Card className="mt-4 border-zinc-800 bg-zinc-900 p-0">
        {list.isLoading ? (
          <div className="grid place-items-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
          </div>
        ) : rows.length === 0 ? (
          <p className="p-6 text-sm text-zinc-500">Aucun abonnement ne correspond à ces filtres.</p>
        ) : (
          <>
            {/* Mobile : cartes */}
            <ul className="divide-y divide-zinc-800 lg:hidden">
              {rows.map((r) => (
                <li key={r.id} className="p-4">
                  <Link
                    to="/admin/companies/$id"
                    params={{ id: r.company_id }}
                    className="font-medium text-zinc-100 hover:underline"
                  >
                    {r.company_name}
                  </Link>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                    <Badge variant="outline">{r.plan_label}</Badge>
                    <Badge variant={r.status === "active" ? "default" : "secondary"}>
                      {STATUS_LABEL[r.status] ?? r.status}
                    </Badge>
                    <span>{r.billing_interval === "annual" ? "Annuel" : "Mensuel"}</span>
                    <span>{euro(r.price_ht_eur)} HT/mois</span>
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">
                    Sièges {r.seats} · Prochaine échéance {date(r.current_period_end)}
                    {r.cancel_at_period_end ? " · résiliation programmée" : ""}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2 min-h-[44px]"
                    disabled={busyId === r.company_id}
                    onClick={() => onRefresh(r.company_id)}
                  >
                    {busyId === r.company_id ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-2 h-4 w-4" />
                    )}
                    Relire Stripe
                  </Button>
                </li>
              ))}
            </ul>

            {/* Desktop : tableau */}
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full text-sm">
                <thead className="border-b border-zinc-800 text-left text-xs uppercase tracking-wider text-zinc-500">
                  <tr>
                    <th scope="col" className="p-3">Entreprise</th>
                    <th scope="col" className="p-3">Plan</th>
                    <th scope="col" className="p-3">Statut</th>
                    <th scope="col" className="p-3">Périodicité</th>
                    <th scope="col" className="p-3">HT / mois</th>
                    <th scope="col" className="p-3">Sièges</th>
                    <th scope="col" className="p-3">Échéance</th>
                    <th scope="col" className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800 text-zinc-300">
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="p-3">
                        <Link
                          to="/admin/companies/$id"
                          params={{ id: r.company_id }}
                          className="text-zinc-100 hover:underline"
                        >
                          {r.company_name}
                        </Link>
                        <div className="text-xs text-zinc-500">{r.company_email ?? "—"}</div>
                      </td>
                      <td className="p-3"><Badge variant="outline">{r.plan_label}</Badge></td>
                      <td className="p-3">
                        <Badge variant={r.status === "active" ? "default" : "secondary"}>
                          {STATUS_LABEL[r.status] ?? r.status}
                        </Badge>
                        {r.cancel_at_period_end && (
                          <div className="text-xs text-amber-400">résiliation programmée</div>
                        )}
                      </td>
                      <td className="p-3">{r.billing_interval === "annual" ? "Annuel" : "Mensuel"}</td>
                      <td className="p-3">{euro(r.price_ht_eur)}</td>
                      <td className="p-3">{r.seats}</td>
                      <td className="p-3">{date(r.current_period_end)}</td>
                      <td className="p-3 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyId === r.company_id}
                          onClick={() => onRefresh(r.company_id)}
                        >
                          {busyId === r.company_id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <RefreshCw className="h-4 w-4" />
                          )}
                          <span className="ml-2">Relire Stripe</span>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between border-t border-zinc-800 p-3 text-xs text-zinc-500">
              <span>
                {total} abonnement{total > 1 ? "s" : ""} · page {page}/{pages}
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Précédent
                </Button>
                <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                  Suivant
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

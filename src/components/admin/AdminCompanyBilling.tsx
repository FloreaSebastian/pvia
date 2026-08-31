import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getAdminCompanyBilling, adminRefreshCompanyBilling } from "@/lib/admin-billing.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, FileText, ExternalLink } from "lucide-react";
import { toast } from "sonner";

const euro = (cents: number, currency = "EUR") =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format((cents ?? 0) / 100);
const day = (v?: string | null) =>
  v ? new Date(v).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const STATUS_LABEL: Record<string, string> = {
  trialing: "Essai",
  active: "Actif",
  past_due: "Impayé",
  unpaid: "Non payé",
  canceled: "Résilié",
  paused: "Suspendu",
  draft: "Brouillon",
  open: "À payer",
  paid: "Payée",
  void: "Annulée",
  uncollectible: "Irrécouvrable",
};

/**
 * Onglet « Facturation » de la fiche entreprise (super-admin).
 * Lecture seule : la seule action possible est la relecture Stripe.
 */
export function AdminCompanyBilling({ companyId }: { companyId: string }) {
  const getFn = useServerFn(getAdminCompanyBilling);
  const refreshFn = useServerFn(adminRefreshCompanyBilling);
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const q = useQuery({
    queryKey: ["admin-company-billing", companyId],
    queryFn: () => getFn({ data: { companyId } } as never),
  });

  async function onRefresh() {
    setBusy(true);
    try {
      await refreshFn({ data: { companyId } });
      await queryClient.invalidateQueries({ queryKey: ["admin-company-billing", companyId] });
      toast.success("État relu depuis Stripe.");
    } catch (e: any) {
      toast.error(e?.message ?? "Relecture impossible.");
    } finally {
      setBusy(false);
    }
  }

  const d: any = q.data;

  return (
    <Card className="border-zinc-800 bg-zinc-900 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-100">Facturation</h3>
        <Button size="sm" variant="outline" disabled={busy} onClick={onRefresh} className="min-h-[44px]">
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Relire Stripe
        </Button>
      </div>

      {q.isLoading || !d ? (
        <div className="grid place-items-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
        </div>
      ) : (
        <div className="space-y-4 text-sm text-zinc-300">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-zinc-500">Plan</dt>
              <dd>{d.entitlements.plan_label}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Statut</dt>
              <dd>
                <Badge variant={d.subscription?.status === "active" ? "default" : "secondary"}>
                  {STATUS_LABEL[d.subscription?.status] ?? d.subscription?.status ?? "Aucun abonnement"}
                </Badge>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Périodicité</dt>
              <dd>{d.subscription?.billing_interval === "annual" ? "Annuelle" : d.subscription ? "Mensuelle" : "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Essai</dt>
              <dd>
                {d.company.trial_started_at
                  ? `${day(d.company.trial_started_at)} → ${day(d.company.trial_ends_at)}`
                  : "Non démarré"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Échéance</dt>
              <dd>
                {day(d.subscription?.current_period_end)}
                {d.subscription?.cancel_at_period_end ? " (résiliation programmée)" : ""}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Écriture</dt>
              <dd>{d.entitlements.can_write ? "Autorisée" : "Lecture seule"}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Sièges</dt>
              <dd>
                {d.entitlements.seats_used}
                {d.entitlements.seat_limit != null ? ` / ${d.entitlements.seat_limit}` : " (illimités)"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">PV / mois</dt>
              <dd>{d.entitlements.pv_limit_per_month ?? "Illimités"}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Visites techniques</dt>
              <dd>{d.entitlements.can_technical_visits ? "Incluses" : "Non incluses"}</dd>
            </div>
          </dl>

          <div>
            <h4 className="mb-1 text-xs uppercase tracking-wider text-zinc-500">Factures Stripe</h4>
            {d.stripeError ? (
              <p className="text-xs text-amber-400">{d.stripeError}</p>
            ) : d.invoices.length === 0 ? (
              <p className="text-xs text-zinc-500">Aucune facture.</p>
            ) : (
              <ul className="divide-y divide-zinc-800">
                {d.invoices.map((inv: any) => (
                  <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
                    <span className="text-zinc-300">
                      {inv.number ?? inv.id} · {day(inv.created)}
                    </span>
                    <span className="text-zinc-400">
                      {euro(inv.subtotal_excl_tax, inv.currency)} HT + {euro(inv.tax, inv.currency)} TVA ={" "}
                      <strong className="text-zinc-200">{euro(inv.total, inv.currency)} TTC</strong>
                    </span>
                    <span className="flex items-center gap-2">
                      <Badge variant={inv.status === "paid" ? "default" : "secondary"}>
                        {STATUS_LABEL[inv.status] ?? inv.status}
                      </Badge>
                      {inv.invoice_pdf && (
                        <a
                          href={inv.invoice_pdf}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 underline"
                        >
                          <FileText className="h-3 w-3" aria-hidden /> PDF
                        </a>
                      )}
                      {inv.hosted_invoice_url && (
                        <a
                          href={inv.hosted_invoice_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 underline"
                        >
                          <ExternalLink className="h-3 w-3" aria-hidden /> Voir
                        </a>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h4 className="mb-1 text-xs uppercase tracking-wider text-zinc-500">Événements facturation</h4>
            {d.events.length === 0 ? (
              <p className="text-xs text-zinc-500">Aucun événement.</p>
            ) : (
              <ul className="max-h-56 divide-y divide-zinc-800 overflow-y-auto text-xs">
                {d.events.map((ev: any, i: number) => (
                  <li key={`${ev.action}-${i}`} className="flex justify-between py-1">
                    <span className="font-mono text-zinc-300">{ev.action}</span>
                    <span className="text-zinc-500">{new Date(ev.at).toLocaleString("fr-FR")}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, ExternalLink, FileText, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { getCompanyInvoices, getInvoiceDocumentUrl, type CompanyInvoice } from "@/lib/billing-invoices.functions";
import { getStripeEnvironment } from "@/lib/stripe";

const STATUS_LABEL: Record<string, string> = {
  paid: "Payée",
  open: "Ouverte",
  draft: "Brouillon",
  past_due: "En retard",
  void: "Annulée",
  uncollectible: "Irrécouvrable",
  unknown: "Inconnu",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  paid: "default",
  open: "secondary",
  draft: "outline",
  past_due: "destructive",
  void: "outline",
  uncollectible: "destructive",
  unknown: "outline",
};

function money(cents: number, currency: string) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: currency || "EUR" }).format(cents / 100);
}

function frDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" }) : "—";
}

function periodLabel(inv: CompanyInvoice) {
  if (!inv.period_start || !inv.period_end) return "—";
  const f = (s: string) => new Date(s).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" });
  return `${f(inv.period_start)} → ${f(inv.period_end)}`;
}

export function InvoicesSection({ companyId }: { companyId: string }) {
  const env = getStripeEnvironment();
  const listFn = useServerFn(getCompanyInvoices);
  const docFn = useServerFn(getInvoiceDocumentUrl);
  const [busy, setBusy] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["billing-invoices", companyId, env],
    queryFn: () => listFn({ data: { companyId, environment: env } }),
    enabled: !!companyId,
    staleTime: 60_000,
    retry: 1,
  });

  const openDoc = useCallback(
    async (invoiceId: string, kind: "pdf" | "hosted") => {
      setBusy(`${invoiceId}:${kind}`);
      try {
        const { url } = await docFn({ data: { companyId, environment: env, invoiceId, kind } });
        window.open(url, "_blank", "noopener,noreferrer");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Document indisponible pour le moment.");
      } finally {
        setBusy(null);
      }
    },
    [companyId, docFn, env],
  );

  const invoices = query.data?.invoices ?? [];

  return (
    <section aria-labelledby="factures" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="factures" className="text-xl font-semibold tracking-tight">
          Factures
        </h2>
        <Button
          variant="ghost"
          size="sm"
          className="min-h-[44px]"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />
          Actualiser
        </Button>
      </div>

      {query.isLoading && (
        <Card className="space-y-3 p-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </Card>
      )}

      {query.isError && (
        <Card className="flex flex-col items-start gap-3 p-6 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="text-muted-foreground">
            Impossible de charger vos factures pour le moment.
          </p>
          <Button variant="outline" className="min-h-[44px]" onClick={() => void query.refetch()}>
            Réessayer
          </Button>
        </Card>
      )}

      {!query.isLoading && !query.isError && invoices.length === 0 && (
        <Card className="flex flex-col items-center gap-2 p-8 text-center">
          <FileText className="h-8 w-8 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium">Aucune facture pour le moment</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Vos factures apparaîtront ici dès votre premier paiement. Elles sont émises et conservées par Stripe.
          </p>
        </Card>
      )}

      {invoices.length > 0 && (
        <>
          {/* Desktop : tableau */}
          <Card className="hidden overflow-hidden p-0 lg:block">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">Factures Stripe de votre entreprise</caption>
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left">
                    <th scope="col" className="px-3 py-3 font-semibold">Date</th>
                    <th scope="col" className="px-3 py-3 font-semibold">N° facture</th>
                    <th scope="col" className="px-3 py-3 font-semibold">Période</th>
                    <th scope="col" className="px-3 py-3 font-semibold">Formule</th>
                    <th scope="col" className="px-3 py-3 text-right font-semibold">HT</th>
                    <th scope="col" className="px-3 py-3 text-right font-semibold">TVA</th>
                    <th scope="col" className="px-3 py-3 text-right font-semibold">TTC</th>
                    <th scope="col" className="px-3 py-3 font-semibold">Statut</th>
                    <th scope="col" className="px-3 py-3 text-right font-semibold">Documents</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id} className="border-b border-border/40 last:border-0">
                      <td className="px-3 py-3">{frDate(inv.created)}</td>
                      <td className="px-3 py-3 font-mono text-xs">{inv.number ?? "—"}</td>
                      <td className="px-3 py-3 text-xs text-muted-foreground">{periodLabel(inv)}</td>
                      <td className="px-3 py-3">{inv.plan_label ?? "—"}</td>
                      <td className="px-3 py-3 text-right">{money(inv.subtotal_excl_tax, inv.currency)}</td>
                      <td className="px-3 py-3 text-right">{money(inv.tax, inv.currency)}</td>
                      <td className="px-3 py-3 text-right font-medium">{money(inv.total, inv.currency)}</td>
                      <td className="px-3 py-3">
                        <Badge variant={STATUS_VARIANT[inv.status]}>{STATUS_LABEL[inv.status]}</Badge>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex justify-end gap-1">
                          {inv.has_pdf && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => void openDoc(inv.id, "pdf")}
                              disabled={busy === `${inv.id}:pdf`}
                              aria-label={`Télécharger le PDF de la facture ${inv.number ?? ""}`}
                            >
                              {busy === `${inv.id}:pdf` ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Download className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                          {inv.has_hosted_page && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => void openDoc(inv.id, "hosted")}
                              disabled={busy === `${inv.id}:hosted`}
                              aria-label={`Voir la facture ${inv.number ?? ""} chez Stripe`}
                            >
                              {busy === `${inv.id}:hosted` ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <ExternalLink className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Mobile / tablette : cartes */}
          <div className="grid gap-3 lg:hidden">
            {invoices.map((inv) => (
              <Card key={inv.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium">{frDate(inv.created)}</div>
                    <div className="font-mono text-xs text-muted-foreground">{inv.number ?? "—"}</div>
                  </div>
                  <Badge variant={STATUS_VARIANT[inv.status]}>{STATUS_LABEL[inv.status]}</Badge>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">Formule</dt>
                  <dd className="text-right">{inv.plan_label ?? "—"}</dd>
                  <dt className="text-muted-foreground">Période</dt>
                  <dd className="text-right text-xs">{periodLabel(inv)}</dd>
                  <dt className="text-muted-foreground">Montant HT</dt>
                  <dd className="text-right">{money(inv.subtotal_excl_tax, inv.currency)}</dd>
                  <dt className="text-muted-foreground">TVA</dt>
                  <dd className="text-right">{money(inv.tax, inv.currency)}</dd>
                  <dt className="font-medium">Montant TTC</dt>
                  <dd className="text-right font-medium">{money(inv.total, inv.currency)}</dd>
                </dl>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  {inv.has_pdf && (
                    <Button
                      variant="outline"
                      className="min-h-[44px] flex-1"
                      onClick={() => void openDoc(inv.id, "pdf")}
                      disabled={busy === `${inv.id}:pdf`}
                    >
                      {busy === `${inv.id}:pdf` ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="mr-2 h-4 w-4" />
                      )}
                      Télécharger le PDF
                    </Button>
                  )}
                  {inv.has_hosted_page && (
                    <Button
                      variant="ghost"
                      className="min-h-[44px] flex-1"
                      onClick={() => void openDoc(inv.id, "hosted")}
                      disabled={busy === `${inv.id}:hosted`}
                    >
                      {busy === `${inv.id}:hosted` ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <ExternalLink className="mr-2 h-4 w-4" />
                      )}
                      Voir la facture
                    </Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

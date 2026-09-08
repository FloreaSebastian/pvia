/**
 * Centre de conformité — pilotage de TOUS les partenaires du tenant.
 *
 * L'UI n'effectue aucun calcul de conformité : elle affiche les statuts
 * renvoyés par le serveur (`getComplianceCenter`). Aucun lien de fichier
 * signé n'est manipulé ici : les pièces s'ouvrent depuis la fiche partenaire.
 */
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BellRing, FileCheck2, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { useCompany } from "@/hooks/use-company";
import { RouteRoleGuard } from "@/components/auth/RouteRoleGuard";
import { ADMIN_ROLES } from "@/lib/roles";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ComplianceBadge } from "@/components/subcontractors/ComplianceBadge";
import { ComplianceDialog } from "@/components/subcontractors/ComplianceDialog";
import {
  docTypeLabel,
  formatFrDate,
  SUBCONTRACTOR_DOC_TYPES,
} from "@/lib/subcontractor-compliance";
import {
  getComplianceCenter,
  listPendingSubcontractorDocuments,
  remindSubcontractorPartner,
  reviewSubcontractorDocument,
} from "@/lib/subcontractor-documents.functions";

export const Route = createFileRoute("/_authenticated/conformite")({
  component: () => (
    <RouteRoleGuard allow={ADMIN_ROLES}>
      <CompliancePage />
    </RouteRoleGuard>
  ),
  head: () => ({
    meta: [
      { title: "Centre de conformité sous-traitants — PVIA" },
      {
        name: "description",
        content:
          "Pilotez les pièces administratives de tous vos sous-traitants : validation, échéances, relances et partenaires bloqués.",
      },
      { property: "og:title", content: "Centre de conformité sous-traitants — PVIA" },
      {
        property: "og:description",
        content: "Validation des pièces, suivi des échéances et relances de vos partenaires.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

type Filter =
  | "all"
  | "blocking"
  | "pending_review"
  | "expiring7"
  | "expiring30"
  | "expiring60"
  | "expired"
  | "compliant";

function Kpi({
  label,
  value,
  active,
  onClick,
}: {
  label: string;
  value: number;
  active?: boolean;
  onClick?: () => void;
}) {
  const content = (
    <>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-display text-2xl font-bold">{value}</p>
    </>
  );
  if (!onClick) return <Card className="p-3">{content}</Card>;
  return (
    <Card
      role="button"
      tabIndex={0}
      aria-pressed={!!active}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={`min-h-16 cursor-pointer p-3 text-left transition hover:border-primary/50 ${
        active ? "border-primary ring-1 ring-primary" : ""
      }`}
    >
      {content}
    </Card>
  );
}


function CompliancePage() {
  const { activeCompanyId } = useCompany();
  const qc = useQueryClient();
  const centerFn = useServerFn(getComplianceCenter);
  const pendingFn = useServerFn(listPendingSubcontractorDocuments);
  const reviewFn = useServerFn(reviewSubcontractorDocument);
  const remindFn = useServerFn(remindSubcontractorPartner);

  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [trade, setTrade] = useState("all");
  const [docType, setDocType] = useState("all");
  const [docsFor, setDocsFor] = useState<{ id: string; name: string } | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const center = useQuery({
    queryKey: ["compliance-center", activeCompanyId],
    queryFn: () => centerFn({ data: { companyId: activeCompanyId! } }),
    enabled: !!activeCompanyId,
  });
  const pending = useQuery({
    queryKey: ["compliance-pending", activeCompanyId],
    queryFn: () => pendingFn({ data: { companyId: activeCompanyId! } }),
    enabled: !!activeCompanyId,
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["compliance-center", activeCompanyId] });
    void qc.invalidateQueries({ queryKey: ["compliance-pending", activeCompanyId] });
    void qc.invalidateQueries({ queryKey: ["sc-compliance", activeCompanyId] });
  };

  const mReview = useMutation({
    mutationFn: (v: { documentId: string; decision: "approve" | "reject"; reason?: string }) =>
      reviewFn({
        data: {
          companyId: activeCompanyId!,
          documentId: v.documentId,
          decision: v.decision,
          reason: v.reason ?? "",
        },
      }),
    onSuccess: (_r, v) => {
      toast.success(v.decision === "approve" ? "Pièce validée." : "Pièce refusée, le partenaire est prévenu.");
      setRejectId(null);
      setReason("");
      refresh();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Décision impossible."),
  });

  const mRemind = useMutation({
    mutationFn: (v: { partnerId: string; reason: "missing" | "expired" | "expiring_soon" | "rejected" | "general" }) =>
      remindFn({
        data: { companyId: activeCompanyId!, subcontractorCompanyId: v.partnerId, reason: v.reason },
      }),
    onSuccess: (r) =>
      toast.success(
        r.skipped
          ? "Relance déjà envoyée récemment pour ce motif."
          : `Relance envoyée à ${r.recipients} destinataire(s).`,
      ),
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Relance impossible."),
  });

  const partners = center.data?.partners ?? [];

  /** Métiers réellement présents chez ce tenant (pas de liste figée). */
  const trades = useMemo(() => {
    const set = new Set<string>();
    for (const p of partners) for (const t of p.trades ?? []) set.add(t);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "fr"));
  }, [partners]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const digits = needle.replace(/\D/g, "");
    const withinDays = (p: (typeof partners)[number], n: number) =>
      p.summary.lines.some(
        (l) => l.daysToExpiry !== null && l.daysToExpiry >= 0 && l.daysToExpiry <= n,
      );
    return partners
      .filter((p) => !p.archived)
      .filter((p) => {
        if (!needle) return true;
        // Recherche nom + SIRET (chiffres seuls) + e-mail de contact.
        const siret = (p.siret ?? "").replace(/\D/g, "");
        return (
          p.name.toLowerCase().includes(needle) ||
          (p.email ?? "").toLowerCase().includes(needle) ||
          (digits.length >= 3 && siret.includes(digits))
        );
      })
      .filter((p) => (trade === "all" ? true : (p.trades ?? []).includes(trade)))
      .filter((p) =>
        docType === "all"
          ? true
          : p.summary.lines.some((l) => l.docType === docType && l.status !== "valid" && l.status !== "no_expiry"),
      )
      .filter((p) => {
        if (filter === "all") return true;
        if (filter === "expiring7") return withinDays(p, 7);
        if (filter === "expiring30") return withinDays(p, 30);
        if (filter === "expiring60") return withinDays(p, 60);
        if (filter === "expired") return p.summary.counts.expired > 0;
        if (filter === "pending_review") return p.summary.counts.pendingReview > 0;
        return p.summary.status === filter;
      });
  }, [partners, q, filter, trade, docType]);

  const kpis = center.data?.kpis;

  return (
    <div className="space-y-4 px-3 py-4 sm:px-6">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight">Centre de conformité</h1>
        <p className="text-sm text-muted-foreground">
          Statuts calculés selon VOS règles de pièces. Aucune valeur légale.
        </p>
      </header>

      {center.isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            <Kpi
              label="Partenaires actifs"
              value={kpis?.activePartners ?? 0}
              active={filter === "all"}
              onClick={() => setFilter("all")}
            />
            <Kpi
              label="Conformes"
              value={kpis?.compliant ?? 0}
              active={filter === "compliant"}
              onClick={() => setFilter("compliant")}
            />
            <Kpi
              label="Bloqués"
              value={kpis?.blocked ?? 0}
              active={filter === "blocking"}
              onClick={() => setFilter("blocking")}
            />
            <Kpi
              label="À vérifier"
              value={kpis?.pendingReview ?? 0}
              active={filter === "pending_review"}
              onClick={() => setFilter("pending_review")}
            />
            <Kpi
              label="Échéance < 7 j"
              value={kpis?.expiring7 ?? 0}
              active={filter === "expiring7"}
              onClick={() => setFilter("expiring7")}
            />
            <Kpi
              label="Échéance < 30 j"
              value={kpis?.expiring30 ?? 0}
              active={filter === "expiring30"}
              onClick={() => setFilter("expiring30")}
            />
            <Kpi
              label="Échéance < 60 j"
              value={kpis?.expiring60 ?? 0}
              active={filter === "expiring60"}
              onClick={() => setFilter("expiring60")}
            />
            <Kpi
              label="Expirées"
              value={kpis?.expired ?? 0}
              active={filter === "expired"}
              onClick={() => setFilter("expired")}
            />
          </div>

          <Tabs defaultValue="partners">
            <TabsList className="w-full">
              <TabsTrigger className="min-h-11 flex-1" value="partners">
                Partenaires
              </TabsTrigger>
              <TabsTrigger className="min-h-11 flex-1" value="queue">
                À valider ({pending.data?.documents.length ?? 0})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="partners" className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <Label htmlFor="cc-search">Rechercher (nom, SIRET, e-mail)</Label>
                  <div className="relative">
                    <Search
                      className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <Input
                      id="cc-search"
                      className="h-11 pl-9"
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      placeholder="Nom, SIRET ou e-mail"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      ["all", "Tous"],
                      ["blocking", "Bloquants"],
                      ["pending_review", "En attente de validation"],
                      ["expiring7", "< 7 j"],
                      ["expiring30", "< 30 j"],
                      ["expiring60", "< 60 j"],
                      ["expired", "Expirées"],
                      ["compliant", "Conformes"],
                    ] as Array<[Filter, string]>
                  ).map(([key, label]) => (
                    <Button
                      key={key}
                      variant={filter === key ? "default" : "outline"}
                      className="h-11"
                      onClick={() => setFilter(key)}
                      aria-pressed={filter === key}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <Label htmlFor="cc-trade">Métier</Label>
                  <select
                    id="cc-trade"
                    className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={trade}
                    onChange={(e) => setTrade(e.target.value)}
                  >
                    <option value="all">Tous les métiers</option>
                    {trades.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="cc-doctype">Type de pièce en défaut</Label>
                  <select
                    id="cc-doctype"
                    className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={docType}
                    onChange={(e) => setDocType(e.target.value)}
                  >
                    <option value="all">Tous les types</option>
                    {SUBCONTRACTOR_DOC_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {docTypeLabel(t)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {rows.length === 0 ? (
                <Card className="p-4 text-sm text-muted-foreground">Aucun partenaire pour ce filtre.</Card>
              ) : (
                <ul className="space-y-2">
                  {rows.map((p) => (
                    <li key={p.id}>
                      <Card className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{p.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {p.summary.counts.pendingReview > 0
                              ? `${p.summary.counts.pendingReview} pièce(s) à vérifier · `
                              : ""}
                            {p.summary.nextExpiry
                              ? `Prochaine échéance : ${p.summary.nextExpiry.label} le ${formatFrDate(
                                  p.summary.nextExpiry.date,
                                )}`
                              : "Aucune échéance à venir"}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <ComplianceBadge status={p.summary.status} />
                          <Button
                            variant="outline"
                            className="h-11"
                            onClick={() => mRemind.mutate({ partnerId: p.id, reason: "general" })}
                            disabled={mRemind.isPending}
                          >
                            <BellRing className="mr-1.5 h-4 w-4" aria-hidden="true" />
                            Relancer
                          </Button>
                          <Button className="h-11" onClick={() => setDocsFor({ id: p.id, name: p.name })}>
                            <FileCheck2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
                            Documents
                          </Button>
                        </div>
                      </Card>
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>

            <TabsContent value="queue" className="space-y-2">
              {(pending.data?.documents.length ?? 0) === 0 ? (
                <Card className="p-4 text-sm text-muted-foreground">Aucune pièce en attente de vérification.</Card>
              ) : (
                <ul className="space-y-2">
                  {pending.data!.documents.map((d) => (
                    <li key={d.id}>
                      <Card className="space-y-2 p-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <p className="truncate font-medium">
                              {d.partnerName} — {d.label}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              Déposée par {d.submittedBy} le {formatFrDate(d.uploadedAt)}
                              {d.expiryDate ? ` · échéance ${formatFrDate(d.expiryDate)}` : ""}
                            </p>
                            {d.isBlocking ? <Badge className="mt-1 bg-destructive">Bloquante</Badge> : null}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="outline"
                              className="h-11"
                              onClick={() => setDocsFor({ id: d.subcontractorCompanyId, name: d.partnerName })}
                            >
                              Consulter
                            </Button>
                            <Button
                              className="h-11"
                              disabled={mReview.isPending}
                              onClick={() => mReview.mutate({ documentId: d.id, decision: "approve" })}
                            >
                              Valider
                            </Button>
                            <Button
                              variant="destructive"
                              className="h-11"
                              onClick={() => {
                                setRejectId(d.id);
                                setReason("");
                              }}
                            >
                              Refuser
                            </Button>
                          </div>
                        </div>
                        {rejectId === d.id && (
                          <div className="space-y-2">
                            <Label htmlFor={`cc-reason-${d.id}`}>
                              Motif du refus (obligatoire, 5 caractères min.)
                            </Label>
                            <Textarea
                              id={`cc-reason-${d.id}`}
                              rows={2}
                              value={reason}
                              onChange={(e) => setReason(e.target.value)}
                            />
                            <div className="flex gap-2">
                              <Button
                                variant="destructive"
                                className="h-11"
                                disabled={mReview.isPending || reason.trim().length < 5}
                                onClick={() => mReview.mutate({ documentId: d.id, decision: "reject", reason })}
                              >
                                Confirmer le refus
                              </Button>
                              <Button variant="ghost" className="h-11" onClick={() => setRejectId(null)}>
                                Annuler
                              </Button>
                            </div>
                          </div>
                        )}
                      </Card>
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>
          </Tabs>
        </>
      )}

      {docsFor && activeCompanyId && (
        <ComplianceDialog
          companyId={activeCompanyId}
          partner={docsFor}
          onClose={() => {
            setDocsFor(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

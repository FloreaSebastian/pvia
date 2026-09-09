import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  ClipboardCheck, Plus, Search, Loader2, MapPin, ChevronRight, SlidersHorizontal, X,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { toast } from "sonner";
import { useCompany } from "@/hooks/use-company";
import { isManageRole } from "@/lib/roles";
import { listStudies } from "@/lib/etudes.functions";
import { STUDY_TYPE_OPTIONS, getStudyTemplate } from "@/lib/etudes/templates";
import { STUDY_STATUS_META, type StudyStatus, type StudyType } from "@/lib/etudes/types";

export const Route = createFileRoute("/_authenticated/cahiers-des-charges/")({
  head: () => ({
    meta: [
      { title: "Cahiers des charges — PVIA" },
      {
        name: "description",
        content:
          "Pré-études avant-vente photovoltaïque et pompe à chaleur : besoin client, contraintes, pré-dimensionnement indicatif et dossier envoyé au client.",
      },
      { property: "og:title", content: "Cahiers des charges — PVIA" },
      {
        property: "og:description",
        content: "Qualifiez le projet avant la visite technique : besoin, bâtiment, photos, estimation et synthèse client.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: StudiesPage,
});

const PAGE = 30;

type StudyRow = {
  id: string;
  reference: string;
  study_type: string;
  status: string;
  title: string | null;
  site_address: string | null;
  site_city: string | null;
  completion_percent: number | null;
  estimate: { headline?: { label: string; value: string } | null } | null;
  created_at: string;
  sent_at: string | null;
  client?: { id: string; name: string; company_name: string | null; client_type: string | null; email: string | null } | null;
};

function clientLabel(c: StudyRow["client"]): string {
  if (!c) return "Client inconnu";
  return c.client_type === "professionnel" ? c.company_name || c.name : c.name;
}

export function StudyStatusBadge({ status }: { status: string }) {
  const meta = STUDY_STATUS_META[status as StudyStatus] ?? { label: status, tone: "neutral" as const };
  const tone: Record<string, string> = {
    neutral: "bg-muted text-muted-foreground",
    info: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
    warn: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    success: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    danger: "bg-destructive/15 text-destructive",
    muted: "bg-muted text-muted-foreground",
  };
  return <Badge variant="secondary" className={tone[meta.tone]}>{meta.label}</Badge>;
}

function StudiesPage() {
  const { activeCompanyId, activeRole } = useCompany();
  const canManage = isManageRole(activeRole);
  const navigate = useNavigate();
  const listFn = useServerFn(listStudies);

  const [rows, setRows] = useState<StudyRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [type, setType] = useState<StudyType | "all">("all");
  const [status, setStatus] = useState<StudyStatus | "all">("all");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(
    async (nextOffset: number) => {
      if (!activeCompanyId) return;
      setLoading(true);
      try {
        const res = await listFn({
          data: {
            companyId: activeCompanyId,
            search: debounced,
            study_type: type === "all" ? null : type,
            status: status === "all" ? null : status,
            include_archived: includeArchived,
            offset: nextOffset,
            limit: PAGE,
          },
        });
        setRows(res.studies as StudyRow[]);
        setTotal(res.total);
        setOffset(nextOffset);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Chargement impossible.");
      } finally {
        setLoading(false);
      }
    },
    [activeCompanyId, debounced, type, status, includeArchived, listFn],
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  const kpis = useMemo(() => {
    const byStatus = (s: string) => rows.filter((r) => r.status === s).length;
    return {
      total,
      enCours: byStatus("draft") + byStatus("in_progress"),
      aValider: byStatus("internal_review"),
      envoyes: byStatus("sent"),
      acceptes: byStatus("accepted"),
    };
  }, [rows, total]);

  const filtersActive = type !== "all" || status !== "all" || includeArchived;

  return (
    <div className="mx-auto w-full max-w-6xl p-4 pb-[calc(env(safe-area-inset-bottom,0px)+5rem)] lg:p-8">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <ClipboardCheck className="h-6 w-6 text-primary" />
            Cahiers des charges
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            La pré-étude avant-vente : besoin du client, contraintes et estimation indicative, avant la visite technique.
          </p>
        </div>
        {canManage && (
          <Button onClick={() => navigate({ to: "/cahiers-des-charges/nouveau" })} className="min-h-11 gap-2">
            <Plus className="h-4 w-4" />
            Nouveau
          </Button>
        )}
      </header>

      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[
          { label: "Total", value: kpis.total },
          { label: "En cours", value: kpis.enCours },
          { label: "À valider", value: kpis.aValider },
          { label: "Envoyés", value: kpis.envoyes },
          { label: "Acceptés", value: kpis.acceptes },
        ].map((k) => (
          <Card key={k.label} className="min-w-0 p-3">
            <div className="text-xs text-muted-foreground">{k.label}</div>
            <div className="text-xl font-semibold tabular-nums">{k.value}</div>
          </Card>
        ))}
      </div>

      <div className="mb-4 flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Référence, client, adresse…"
            className="h-11 pl-8"
            aria-label="Rechercher un cahier des charges"
          />
        </div>
        <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
          <SheetTrigger asChild>
            <Button variant={filtersActive ? "default" : "outline"} size="icon" className="h-11 w-11" aria-label="Filtres">
              <SlidersHorizontal className="h-4 w-4" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-[88vw] max-w-sm overflow-y-auto">
            <SheetHeader className="text-left">
              <SheetTitle>Filtres</SheetTitle>
            </SheetHeader>
            <div className="mt-4 space-y-4">
              <div className="space-y-2">
                <Label>Métier</Label>
                <Select value={type} onValueChange={(v) => setType(v as StudyType | "all")}>
                  <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tous les métiers</SelectItem>
                    {STUDY_TYPE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Statut du cahier des charges</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as StudyStatus | "all")}>
                  <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tous les statuts</SelectItem>
                    {STUDY_STATUS_FILTERS.map((key) => (
                      <SelectItem key={key} value={key}>{STUDY_STATUS_META[key].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Statut du devis</Label>
                <Select value={quoteStatus} onValueChange={(v) => setQuoteStatus(v as QuoteStatus | "all")}>
                  <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tous les devis</SelectItem>
                    {QUOTE_STATUSES.map((key) => (
                      <SelectItem key={key} value={key}>{QUOTE_STATUS_META[key].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                variant="outline"
                className="min-h-11 w-full"
                onClick={() => setIncludeArchived((v) => !v)}
              >
                {includeArchived ? "Masquer les archivés" : "Afficher les archivés"}
              </Button>
              {filtersActive && (
                <Button
                  variant="ghost"
                  className="min-h-11 w-full gap-2"
                  onClick={() => { setType("all"); setStatus("all"); setQuoteStatus("all"); setIncludeArchived(false); }}
                >
                  <X className="h-4 w-4" /> Réinitialiser
                </Button>
              )}

            </div>
          </SheetContent>
        </Sheet>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
        </div>
      ) : rows.length === 0 ? (
        <Card className="p-8 text-center">
          <ClipboardCheck className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Aucun cahier des charges. Créez la première pré-étude pour qualifier un projet.
          </p>
          {canManage && (
            <Button className="mt-4 min-h-11" onClick={() => navigate({ to: "/cahiers-des-charges/nouveau" })}>
              Créer un cahier des charges
            </Button>
          )}
        </Card>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const template = getStudyTemplate(r.study_type as StudyType);
            const headline = r.estimate?.headline?.value ?? null;
            return (
              <li key={r.id}>
                <Link
                  to="/cahiers-des-charges/$id"
                  params={{ id: r.id }}
                  className="block rounded-xl border border-border bg-card p-3 transition-colors hover:bg-muted/40"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">{r.reference}</span>
                        <StudyStatusBadge status={r.status} />
                        <QuoteStatusBadge status={r.quote_status} />
                        <Badge variant="outline">{template?.label ?? r.study_type}</Badge>
                        {headline && <Badge variant="secondary">{headline}</Badge>}

                      </div>
                      <div className="mt-1 truncate font-medium">{clientLabel(r.client)}</div>
                      {(r.site_address || r.site_city) && (
                        <div className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                          <MapPin className="h-3 w-3 shrink-0" />
                          <span className="truncate">{[r.site_address, r.site_city].filter(Boolean).join(", ")}</span>
                        </div>
                      )}
                      <div className="mt-2 flex items-center gap-2">
                        <Progress value={r.completion_percent ?? 0} className="h-1.5 flex-1" />
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {r.completion_percent ?? 0} %
                        </span>
                      </div>
                    </div>
                    <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {!loading && total > PAGE && (
        <div className="mt-4 flex items-center justify-between gap-2">
          <Button
            variant="outline"
            className="min-h-11"
            disabled={offset === 0}
            onClick={() => void load(Math.max(0, offset - PAGE))}
          >
            Précédent
          </Button>
          <span className="text-xs text-muted-foreground">
            {offset + 1} – {Math.min(offset + PAGE, total)} sur {total}
          </span>
          <Button
            variant="outline"
            className="min-h-11"
            disabled={offset + PAGE >= total}
            onClick={() => void load(offset + PAGE)}
          >
            Suivant
          </Button>
        </div>
      )}

      {loading && rows.length > 0 && (
        <div className="mt-4 flex justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}

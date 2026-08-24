import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ClipboardList, Plus, Search, SlidersHorizontal, Loader2, MapPin, CalendarClock,
  User as UserIcon, ChevronRight, X, ClipboardCheck, Sparkles,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { useSubscription } from "@/hooks/use-subscription";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { useCompany } from "@/hooks/use-company";
import { isManageRole } from "@/lib/roles";
import { listTechnicalVisits, listVisitAssignees } from "@/lib/visites.functions";
import { VISIT_TEMPLATES, VISIT_TYPE_OPTIONS } from "@/lib/visites/templates";
import { VISIT_STATUS_META, type VisitStatus, type VisitType } from "@/lib/visites/types";
import { VisitStatusBadge } from "@/components/visites/VisitStatusBadge";

export const Route = createFileRoute("/_authenticated/visites-techniques/")({
  head: () => ({
    meta: [
      { title: "Visites techniques — PVIA" },
      {
        name: "description",
        content:
          "Planifiez et pilotez vos visites techniques photovoltaïque et pompe à chaleur : relevés terrain, photos géolocalisées et contraintes.",
      },
      { property: "og:title", content: "Visites techniques — PVIA" },
      {
        property: "og:description",
        content: "Relevés terrain photovoltaïque et PAC : planification, photos obligatoires, contraintes et rapport.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: VisitesTechniquesPage,
});

const PAGE = 30;

type VisitRow = {
  id: string;
  reference: string;
  visit_type: string;
  status: string;
  scheduled_at: string | null;
  completed_at: string | null;
  validated_at: string | null;
  completion_percent: number | null;
  assigned_to: string | null;
  created_at: string;
  chantier?: { id: string; reference: string | null; name: string; address: string | null; city: string | null; postal_code: string | null } | null;
  client?: { id: string; name: string; company_name: string | null; client_type: string | null } | null;
};

function clientLabel(c: VisitRow["client"]): string {
  if (!c) return "Client inconnu";
  return c.client_type === "professionnel" ? c.company_name || c.name : c.name;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "Non planifiée";
  return new Date(iso).toLocaleString("fr-FR", {
    timeZone: "Europe/Paris",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function VisitesTechniquesPage() {
  const { activeCompanyId, activeRole } = useCompany();
  const { hasFeature, isLoading: planLoading } = useSubscription();
  const planAllowed = hasFeature("technical_visits");
  const canManage = isManageRole(activeRole) && planAllowed;

  const listFn = useServerFn(listTechnicalVisits);
  const assigneesFn = useServerFn(listVisitAssignees);

  const [rows, setRows] = useState<VisitRow[]>([]);
  const [kpis, setKpis] = useState({ total: 0, a_planifier: 0, aujourdhui: 0, en_cours: 0, a_valider: 0 });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);

  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [type, setType] = useState<VisitType | "all">("all");
  const [status, setStatus] = useState<VisitStatus | "all">("all");
  const [assignee, setAssignee] = useState<string | "all">("all");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [assignees, setAssignees] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (!activeCompanyId) return;
    let cancelled = false;
    assigneesFn({ data: { companyId: activeCompanyId } })
      .then((r) => !cancelled && setAssignees(r.assignees.map((a) => ({ id: a.id, name: a.name }))))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [activeCompanyId, assigneesFn]);

  const load = useCallback(
    async (nextOffset: number, append: boolean) => {
      if (!activeCompanyId) return;
      if (append) setLoadingMore(true);
      else setLoading(true);
      try {
        const res = await listFn({
          data: {
            companyId: activeCompanyId,
            search: debounced,
            visit_type: type === "all" ? null : type,
            status: status === "all" ? null : status,
            assigned_to: assignee === "all" ? null : assignee,
            include_archived: includeArchived,
            offset: nextOffset,
            limit: PAGE,
          },
        });
        setRows((prev) => (append ? [...prev, ...(res.visits as unknown as VisitRow[])] : (res.visits as unknown as VisitRow[])));
        setKpis(res.kpis);
        setHasMore(res.hasMore);
        setOffset(nextOffset);
      } catch (e: any) {
        toast.error(e?.message ?? "Chargement des visites impossible");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [activeCompanyId, listFn, debounced, type, status, assignee, includeArchived],
  );

  useEffect(() => {
    void load(0, false);
  }, [load]);

  const activeFilters =
    (type !== "all" ? 1 : 0) + (status !== "all" ? 1 : 0) + (assignee !== "all" ? 1 : 0) + (includeArchived ? 1 : 0);

  const kpiCards = useMemo(
    () => [
      { label: "Total", value: kpis.total, tone: "bg-muted", onClick: () => setStatus("all") },
      { label: "À planifier", value: kpis.a_planifier, tone: "bg-amber-100 dark:bg-amber-950/40", onClick: () => setStatus("a_planifier") },
      { label: "Aujourd'hui", value: kpis.aujourdhui, tone: "bg-blue-100 dark:bg-blue-950/40", onClick: () => setStatus("planifiee") },
      { label: "À valider", value: kpis.a_valider, tone: "bg-emerald-100 dark:bg-emerald-950/40", onClick: () => setStatus("terminee") },
    ],
    [kpis],
  );

  return (
    <div className="mx-auto w-full max-w-6xl min-w-0 space-y-4 px-3 pb-24 pt-3 sm:px-4 sm:pb-8">
      <header className="min-w-0 space-y-1">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 truncate text-xl font-semibold sm:text-2xl">
              <ClipboardList className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              Visites techniques
            </h1>
            <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
              Photovoltaïque, PAC air/air et air/eau — relevé terrain complet.
            </p>
          </div>
          {canManage ? (
            <Button asChild className="h-11 shrink-0">
              <Link to="/visites-techniques/nouvelle">
                <Plus className="h-4 w-4 sm:mr-2" aria-hidden="true" />
                <span className="hidden sm:inline">Nouvelle visite</span>
                <span className="sr-only sm:hidden">Nouvelle visite</span>
              </Link>
            </Button>
          ) : null}
        </div>
      </header>

      {!planLoading && !planAllowed ? (
        <Card className="flex min-w-0 flex-col gap-3 border-dashed border-primary/40 bg-primary/5 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            La visite technique est incluse à partir du plan Pro
          </div>
          <p className="text-sm text-muted-foreground">
            Vos visites déjà enregistrées restent consultables. La création de nouvelles visites
            nécessite un plan Pro, Business ou Entreprise.
          </p>
          <Button asChild className="h-11 self-start">
            <Link to="/billing">Voir les formules</Link>
          </Button>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {kpiCards.map((k) => (
          <button
            key={k.label}
            type="button"
            onClick={k.onClick}
            className={`min-w-0 rounded-xl p-3 text-left transition hover:opacity-90 ${k.tone}`}
          >
            <p className="truncate text-xs text-muted-foreground">{k.label}</p>
            <p className="mt-0.5 text-2xl font-semibold tabular-nums">{k.value}</p>
          </button>
        ))}
      </div>

      <div className="sticky top-0 z-10 -mx-3 flex min-w-0 gap-2 border-b bg-background/95 px-3 py-2 backdrop-blur sm:-mx-4 sm:px-4">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Référence, chantier, client…"
            aria-label="Rechercher une visite technique"
            className="h-11 pl-9 pr-9"
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Effacer la recherche"
              className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" className="h-11 shrink-0">
              <SlidersHorizontal className="h-4 w-4 sm:mr-2" aria-hidden="true" />
              <span className="hidden sm:inline">Filtres</span>
              {activeFilters > 0 ? (
                <Badge className="ml-1 h-5 min-w-5 justify-center px-1 tabular-nums">{activeFilters}</Badge>
              ) : null}
              <span className="sr-only sm:hidden">Filtres</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="flex max-h-[85dvh] flex-col gap-0 p-0">
            <SheetHeader className="border-b p-4 text-left">
              <SheetTitle>Filtrer les visites</SheetTitle>
              <SheetDescription>Affinez la liste par métier, statut ou technicien.</SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
              <div className="space-y-2">
                <Label htmlFor="f-type">Type de visite</Label>
                <Select value={type} onValueChange={(v) => setType(v as VisitType | "all")}>
                  <SelectTrigger id="f-type" className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="min-h-11">
                      Tous les métiers
                    </SelectItem>
                    {VISIT_TYPE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value} className="min-h-11">
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="f-status">Statut</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as VisitStatus | "all")}>
                  <SelectTrigger id="f-status" className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="min-h-11">
                      Tous les statuts
                    </SelectItem>
                    {(Object.keys(VISIT_STATUS_META) as VisitStatus[]).map((s) => (
                      <SelectItem key={s} value={s} className="min-h-11">
                        {VISIT_STATUS_META[s].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="f-assignee">Technicien</Label>
                <Select value={assignee} onValueChange={setAssignee}>
                  <SelectTrigger id="f-assignee" className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="min-h-11">
                      Tous
                    </SelectItem>
                    {assignees.map((a) => (
                      <SelectItem key={a.id} value={a.id} className="min-h-11">
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <label className="flex min-h-11 items-center justify-between gap-3 rounded-md border px-3">
                <span className="text-sm">Inclure les visites archivées</span>
                <input
                  type="checkbox"
                  checked={includeArchived}
                  onChange={(e) => setIncludeArchived(e.target.checked)}
                  className="h-5 w-5"
                />
              </label>
            </div>
            <SheetFooter className="border-t p-4">
              <Button
                type="button"
                variant="outline"
                className="h-11 flex-1"
                onClick={() => {
                  setType("all");
                  setStatus("all");
                  setAssignee("all");
                  setIncludeArchived(false);
                }}
              >
                Réinitialiser
              </Button>
              <Button type="button" className="h-11 flex-1" onClick={() => setFiltersOpen(false)}>
                Voir les résultats
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card className="flex min-w-0 flex-col items-center gap-3 p-6 text-center">
          <ClipboardCheck className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <div>
            <p className="font-medium">Aucune visite technique</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Créez une visite : le chantier est généré automatiquement s'il n'existe pas encore.
            </p>
          </div>
          {canManage ? (
            <Button asChild className="h-11">
              <Link to="/visites-techniques/nouvelle">
                <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                Nouvelle visite
              </Link>
            </Button>
          ) : null}
        </Card>
      ) : (
        <ul className="space-y-2">
          {rows.map((v) => {
            const template = VISIT_TEMPLATES[v.visit_type as VisitType];
            const percent = v.completion_percent ?? 0;
            return (
              <li key={v.id}>
                <Link
                  to="/visites-techniques/$id"
                  params={{ id: v.id }}
                  className="block min-w-0 rounded-xl border p-3 transition hover:border-primary/50 hover:bg-muted/40"
                >
                  <div className="flex min-w-0 items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">{v.reference}</span>
                        <VisitStatusBadge status={v.status} />
                        <Badge variant="outline" className="max-w-full truncate">
                          {template?.label ?? v.visit_type}
                        </Badge>
                      </div>
                      <p className="mt-1 break-words text-sm font-medium">{v.chantier?.name ?? "Chantier"}</p>
                      <p className="mt-0.5 break-words text-xs text-muted-foreground">{clientLabel(v.client)}</p>
                      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="inline-flex min-w-0 items-center gap-1">
                          <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          <span className="truncate">{fmtDate(v.scheduled_at)}</span>
                        </span>
                        {v.chantier?.city ? (
                          <span className="inline-flex min-w-0 items-center gap-1">
                            <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            <span className="truncate">{v.chantier.city}</span>
                          </span>
                        ) : null}
                        {v.assigned_to ? (
                          <span className="inline-flex min-w-0 items-center gap-1">
                            <UserIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            <span className="truncate">
                              {assignees.find((a) => a.id === v.assigned_to)?.name ?? "Assignée"}
                            </span>
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <Progress value={percent} className="h-1.5 flex-1" aria-label={`Complétude ${percent}%`} />
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{percent}%</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {hasMore ? (
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full"
          onClick={() => load(offset + PAGE, true)}
          disabled={loadingMore}
        >
          {loadingMore ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          Charger plus
        </Button>
      ) : null}
    </div>
  );
}

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useCallback } from "react";
import {
  Plus, Download, Trash2, FileText, Search, X, ChevronRight, Calendar,
  Building2, AlertTriangle, CheckCircle2, Share2, ArrowUpDown,
  Clock, FileCheck2, ShieldAlert, Files,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuRadioGroup, DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useCompany } from "@/hooks/use-company";
import { PvStatusPill, StatusPill } from "@/components/ui/status-pill";
import { PageHeader } from "@/components/app/PageHeader";

export const Route = createFileRoute("/_authenticated/pv/")({
  component: PvList,
  head: () => ({ meta: [{ title: "Procès-verbaux — PVIA" }] }),
});

type Pv = {
  id: string;
  numero: string;
  type: string;
  status: string;
  reception_date: string | null;
  created_at: string;
  pdf_url: string | null;
  reception_with_reserves: boolean | null;
  chantier_id: string | null;
  client_id: string | null;
  chantiers?: { nom: string | null } | null;
  clients?: { nom: string | null; prenom: string | null } | null;
  pv_reserves?: { count: number }[] | null;
};

const STATUS_FILTERS = [
  { id: "all", label: "Tous" },
  { id: "brouillon", label: "Brouillons" },
  { id: "en_attente", label: "En attente" },
  { id: "signe", label: "Signés" },
  { id: "archive", label: "Archivés" },
] as const;
type StatusFilterId = (typeof STATUS_FILTERS)[number]["id"];

const RESERVE_FILTERS = [
  { id: "all", label: "Toutes réserves" },
  { id: "with", label: "Avec réserves" },
  { id: "without", label: "Sans réserve" },
] as const;
type ReserveFilterId = (typeof RESERVE_FILTERS)[number]["id"];

type SortId = "recent" | "old" | "signed_first" | "pending_first";
const SORT_OPTIONS: { id: SortId; label: string }[] = [
  { id: "recent", label: "Plus récent" },
  { id: "old", label: "Plus ancien" },
  { id: "signed_first", label: "Signés d'abord" },
  { id: "pending_first", label: "En attente d'abord" },
];

const PAGE_SIZE = 60;
const SORT_STORAGE_KEY = "pvia.pv.list.sort";

function formatDate(d: string | null) {
  return d ? new Date(d).toLocaleDateString("fr-FR") : "—";
}
function clientName(c: Pv["clients"]) {
  if (!c) return null;
  return [c.prenom, c.nom].filter(Boolean).join(" ") || null;
}
function reservesCount(p: Pv) {
  return p.pv_reserves?.[0]?.count ?? 0;
}

function PvList() {
  const { activeCompanyId } = useCompany();
  const navigate = useNavigate();
  const [items, setItems] = useState<Pv[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilterId>("all");
  const [reserveFilter, setReserveFilter] = useState<ReserveFilterId>("all");
  const [sort, setSort] = useState<SortId>(() => {
    if (typeof window === "undefined") return "recent";
    return (localStorage.getItem(SORT_STORAGE_KEY) as SortId) || "recent";
  });
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem(SORT_STORAGE_KEY, sort);
  }, [sort]);

  const load = useCallback(async () => {
    if (!activeCompanyId) return;
    setLoading(true);
    const { data } = await supabase
      .from("pv")
      .select("id,numero,type,status,reception_date,created_at,pdf_url,reception_with_reserves,chantier_id,client_id,chantiers(nom),clients(nom,prenom),pv_reserves(count)")
      .eq("company_id", activeCompanyId)
      .order("created_at", { ascending: false });
    setItems((data as unknown as Pv[]) ?? []);
    setLoading(false);
  }, [activeCompanyId]);
  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length };
    for (const f of STATUS_FILTERS) if (f.id !== "all") c[f.id] = 0;
    for (const p of items) c[p.status] = (c[p.status] ?? 0) + 1;
    const withRes = items.filter((p) => p.reception_with_reserves).length;
    return {
      ...c,
      reserves_with: withRes,
      reserves_without: items.length - withRes,
    };
  }, [items]);

  const filteredSorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    const arr = items.filter((p) => {
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (reserveFilter === "with" && !p.reception_with_reserves) return false;
      if (reserveFilter === "without" && p.reception_with_reserves) return false;
      if (!q) return true;
      const cn = clientName(p.clients ?? null) ?? "";
      const ch = p.chantiers?.nom ?? "";
      return (
        p.numero.toLowerCase().includes(q) ||
        (p.type ?? "").toLowerCase().includes(q) ||
        cn.toLowerCase().includes(q) ||
        ch.toLowerCase().includes(q)
      );
    });
    const cmpDate = (a: Pv, b: Pv) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    const sorted = [...arr];
    if (sort === "recent") sorted.sort(cmpDate);
    else if (sort === "old") sorted.sort((a, b) => -cmpDate(a, b));
    else if (sort === "signed_first")
      sorted.sort((a, b) => (a.status === "signe" ? -1 : 0) - (b.status === "signe" ? -1 : 0) || cmpDate(a, b));
    else if (sort === "pending_first")
      sorted.sort((a, b) => (a.status === "en_attente" ? -1 : 0) - (b.status === "en_attente" ? -1 : 0) || cmpDate(a, b));
    return sorted;
  }, [items, statusFilter, reserveFilter, query, sort]);

  useEffect(() => { setVisible(PAGE_SIZE); }, [statusFilter, reserveFilter, query, sort]);

  const shown = filteredSorted.slice(0, visible);

  async function remove(id: string) {
    if (!confirm("Supprimer ce PV ?")) return;
    const { error } = await supabase.from("pv").delete().eq("id", id);
    if (error) return toast.error(error.message);
    load();
  }
  async function signedUrl(path: string) {
    const { data, error } = await supabase.storage.from("pv-assets").createSignedUrl(path, 60);
    if (error || !data) throw new Error("PDF indisponible");
    return data.signedUrl;
  }
  async function download(path: string | null) {
    if (!path) return;
    try {
      const url = await signedUrl(path);
      window.open(url, "_blank");
    } catch (e: any) {
      toast.error(e?.message ?? "PDF indisponible");
    }
  }
  async function share(p: Pv) {
    try {
      const url = p.pdf_url ? await signedUrl(p.pdf_url) : `${window.location.origin}/pv/${p.id}`;
      const payload = { title: `PV N° ${p.numero}`, text: `Procès-verbal ${p.numero}`, url };
      if (navigator.share) {
        await navigator.share(payload);
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        toast.success("Lien copié");
      } else {
        window.open(url, "_blank");
      }
    } catch (e: any) {
      if (e?.name !== "AbortError") toast.error(e?.message ?? "Partage impossible");
    }
  }

  const kpis = [
    { id: "total", label: "Total", value: items.length, icon: Files, tone: "text-foreground" },
    { id: "signed", label: "Signés", value: counts["signe"] ?? 0, icon: FileCheck2, tone: "text-emerald-600 dark:text-emerald-400" },
    { id: "pending", label: "En attente", value: counts["en_attente"] ?? 0, icon: Clock, tone: "text-amber-600 dark:text-amber-400" },
    { id: "reserves", label: "Avec réserves", value: counts.reserves_with, icon: ShieldAlert, tone: "text-orange-600 dark:text-orange-400" },
  ];

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Procès-verbaux"
        description={`${items.length} document${items.length > 1 ? "s" : ""} au total.`}
        contained={false}
        className="border-0 bg-transparent px-0 py-0"
        actions={
          <Link to="/pv/new">
            <Button className="shadow-brand"><Plus className="h-4 w-4" /> Nouveau PV</Button>
          </Link>
        }
      />

      {/* KPI strip — scroll horizontal on mobile */}
      <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:grid sm:grid-cols-4 sm:gap-3 sm:overflow-visible sm:px-0">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <Card key={k.id} className="flex min-w-[130px] shrink-0 items-center gap-3 p-3 sm:min-w-0">
              <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-muted ${k.tone}`}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{k.label}</div>
                <div className="text-lg font-semibold tabular-nums leading-tight">{k.value}</div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Sticky search + filters */}
      <div className="sticky top-0 z-20 -mx-3 space-y-2 border-b border-border/60 bg-background/85 px-3 py-2 backdrop-blur sm:mx-0 sm:rounded-xl sm:border sm:px-3 sm:py-2.5">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher…"
              className="h-9 pl-9 pr-9"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Effacer la recherche"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 shrink-0 gap-1.5">
                <ArrowUpDown className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Trier</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Trier par</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup value={sort} onValueChange={(v) => setSort(v as SortId)}>
                {SORT_OPTIONS.map((o) => (
                  <DropdownMenuRadioItem key={o.id} value={o.id}>{o.label}</DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Status chips */}
        <div className="-mx-3 flex items-center gap-1.5 overflow-x-auto px-3 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
          {STATUS_FILTERS.map((f) => {
            const active = statusFilter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setStatusFilter(f.id)}
                className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-medium transition sm:h-8 sm:text-xs ${
                  active
                    ? "bg-primary text-primary-foreground shadow-brand"
                    : "border border-border bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                {f.label}
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${active ? "bg-primary-foreground/20" : "bg-muted text-foreground"}`}>
                  {counts[f.id] ?? 0}
                </span>
              </button>
            );
          })}
        </div>

        {/* Reserve chips */}
        <div className="-mx-3 flex items-center gap-1.5 overflow-x-auto px-3 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
          {RESERVE_FILTERS.map((f) => {
            const active = reserveFilter === f.id;
            const count =
              f.id === "all" ? items.length : f.id === "with" ? counts.reserves_with : counts.reserves_without;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setReserveFilter(f.id)}
                className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-medium transition ${
                  active
                    ? "bg-foreground text-background"
                    : "border border-dashed border-border bg-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {f.id === "with" && <AlertTriangle className="h-3 w-3" />}
                {f.id === "without" && <CheckCircle2 className="h-3 w-3" />}
                {f.label}
                <span className="tabular-nums opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* MOBILE: card grid */}
      <div className="md:hidden">
        {loading && (
          <div className="py-16 text-center text-sm text-muted-foreground">Chargement…</div>
        )}
        {!loading && filteredSorted.length === 0 && (
          <EmptyBlock total={items.length} />
        )}
        {!loading && filteredSorted.length > 0 && (
          <>
            <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2">
              {shown.map((p) => (
                <PvCard
                  key={p.id}
                  pv={p}
                  onOpen={() => navigate({ to: "/pv/$id", params: { id: p.id } })}
                  onDownload={() => download(p.pdf_url)}
                  onShare={() => share(p)}
                  onRemove={() => remove(p.id)}
                />
              ))}
            </div>
            {visible < filteredSorted.length && (
              <div className="mt-4 flex justify-center">
                <Button variant="outline" size="sm" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
                  Charger plus ({filteredSorted.length - visible} restants)
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {/* DESKTOP: table */}
      <Card className="hidden overflow-hidden p-0 md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Numéro</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead>Chantier</TableHead>
              <TableHead>Réserves</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={7} className="py-16 text-center text-sm text-muted-foreground">Chargement…</TableCell>
              </TableRow>
            )}
            {!loading && filteredSorted.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-16 text-center">
                  <EmptyBlock total={items.length} />
                </TableCell>
              </TableRow>
            )}
            {!loading && shown.map((p) => {
              const rc = reservesCount(p);
              return (
                <TableRow key={p.id} className="group cursor-pointer hover:bg-muted/40">
                  <TableCell className="font-medium">
                    <Link to="/pv/$id" params={{ id: p.id }} className="font-mono hover:underline">N° {p.numero}</Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{p.type}</TableCell>
                  <TableCell><PvStatusPill status={p.status} /></TableCell>
                  <TableCell className="max-w-[200px] truncate text-muted-foreground">{p.chantiers?.nom ?? "—"}</TableCell>
                  <TableCell>
                    {p.reception_with_reserves ? (
                      <StatusPill tone="warning" size="sm">{rc > 0 ? `${rc} réserves` : "Avec réserves"}</StatusPill>
                    ) : (
                      <StatusPill tone="success" size="sm">Sans réserve</StatusPill>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(p.reception_date)}</TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex items-center gap-1 opacity-60 transition group-hover:opacity-100">
                      <Link to="/pv/$id" params={{ id: p.id }}>
                        <Button size="sm" variant="ghost">Ouvrir</Button>
                      </Link>
                      {p.pdf_url && (
                        <Button size="icon" variant="ghost" onClick={() => download(p.pdf_url)} title="Télécharger PDF">
                          <Download className="h-4 w-4" />
                        </Button>
                      )}
                      <Button size="icon" variant="ghost" onClick={() => share(p)} title="Partager">
                        <Share2 className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => remove(p.id)} title="Supprimer">
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {!loading && visible < filteredSorted.length && (
          <div className="flex justify-center border-t border-border bg-muted/30 p-3">
            <Button variant="outline" size="sm" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
              Charger plus ({filteredSorted.length - visible} restants)
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}

function EmptyBlock({ total }: { total: number }) {
  return (
    <div className="px-4 py-12 text-center">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary">
        <FileText className="h-5 w-5" />
      </div>
      <p className="mt-3 text-sm font-medium">
        {total === 0 ? "Aucun PV pour le moment" : "Aucun résultat"}
      </p>
      <p className="text-xs text-muted-foreground">
        {total === 0
          ? "Démarrez en créant votre premier procès-verbal."
          : "Ajustez vos filtres ou votre recherche."}
      </p>
      {total === 0 && (
        <div className="mt-4">
          <Link to="/pv/new">
            <Button size="sm" className="shadow-brand">
              <Plus className="h-3 w-3" /> Créer le premier PV
            </Button>
          </Link>
        </div>
      )}
    </div>
  );
}

function PvCard({
  pv, onOpen, onDownload, onShare, onRemove,
}: {
  pv: Pv;
  onOpen: () => void;
  onDownload: () => void;
  onShare: () => void;
  onRemove: () => void;
}) {
  const ch = pv.chantiers?.nom;
  const cn = clientName(pv.clients ?? null);
  const rc = reservesCount(pv);
  const withReserves = !!pv.reception_with_reserves;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); }
      }}
      className="group flex h-full flex-col gap-2.5 rounded-2xl border border-border bg-card p-4 shadow-sm transition active:scale-[0.99] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-mono text-sm font-semibold">N° {pv.numero}</div>
          <div className="mt-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">{pv.type || "—"}</div>
        </div>
        <PvStatusPill status={pv.status} size="sm" />
      </div>

      <div className="space-y-1 text-xs">
        {ch && (
          <div className="flex items-center gap-1.5 text-foreground/90">
            <Building2 className="h-3 w-3 shrink-0 text-muted-foreground" />
            <span className="truncate">{ch}</span>
          </div>
        )}
        {cn && <div className="truncate text-muted-foreground">Client : {cn}</div>}
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Calendar className="h-3 w-3 shrink-0" />
          <span className="truncate">{formatDate(pv.reception_date)}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {withReserves ? (
          <StatusPill tone="warning" size="sm" icon={<AlertTriangle />}>
            {rc > 0 ? `${rc} réserve${rc > 1 ? "s" : ""}` : "Avec réserves"}
          </StatusPill>
        ) : (
          <StatusPill tone="success" size="sm" icon={<CheckCircle2 />}>Sans réserve</StatusPill>
        )}
        {pv.pdf_url && <StatusPill tone="info" size="sm">PDF</StatusPill>}
      </div>

      <div className="mt-auto flex items-center justify-between border-t border-border/60 pt-2">
        <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
          Ouvrir <ChevronRight className="h-3 w-3 transition group-hover:translate-x-0.5" />
        </span>
        <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          {pv.pdf_url && (
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onDownload} aria-label="Télécharger PDF">
              <Download className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onShare} aria-label="Partager">
            <Share2 className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onRemove} aria-label="Supprimer">
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </div>
      </div>
    </div>
  );
}

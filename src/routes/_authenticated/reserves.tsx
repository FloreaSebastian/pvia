import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  AlertCircle, ExternalLink, Trash2, Filter, CheckCircle2, Search,
  Download, LayoutGrid, Table as TableIcon, UserPlus, X, ArrowUpDown,
  SlidersHorizontal, Eye, AlertTriangle, Clock, ShieldAlert, CalendarClock,
  ShieldCheck, Plus, MessageSquare, Image as ImageIcon, FileCheck2,
  History as HistoryIcon, Pencil, Printer, Kanban, FileSpreadsheet, Flag,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetFooter,
} from "@/components/ui/sheet";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useIsMobile } from "@/hooks/use-mobile";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { StatusPill } from "@/components/ui/status-pill";
import { useCompany } from "@/hooks/use-company";
import { useServerFn } from "@tanstack/react-start";
import {
  updateReserveStatus, deleteReserve, assignReserve,
  bulkUpdateReserves, exportReservesCsv,
} from "@/lib/reserves.functions";
import { listReservesOverview, type ReserveOverviewEntry } from "@/lib/reserves-overview.functions";
import { ReserveDetailDialog, type ReserveDetail } from "@/components/pv/ReserveDetailDialog";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";

const STATUSES = ["ouverte", "en_cours", "levee", "en_attente_validation", "validee", "rejetee"] as const;
type Status = (typeof STATUSES)[number];

const STATUS_LABEL: Record<Status, string> = {
  ouverte: "Ouverte",
  en_cours: "En cours",
  levee: "Levée",
  en_attente_validation: "À valider",
  validee: "Validée",
  rejetee: "Rejetée",
};
const STATUS_TONE: Record<Status, "destructive" | "warning" | "success" | "neutral"> = {
  ouverte: "destructive",
  en_cours: "warning",
  levee: "warning",
  en_attente_validation: "warning",
  validee: "success",
  rejetee: "neutral",
};

const SORT_OPTIONS = [
  { value: "recent", label: "Plus récentes" },
  { value: "oldest", label: "Plus anciennes" },
  { value: "due_asc", label: "Échéance ↑" },
  { value: "due_desc", label: "Échéance ↓" },
  { value: "severity", label: "Gravité (majeure d'abord)" },
  { value: "status", label: "Statut" },
] as const;
type SortKey = (typeof SORT_OPTIONS)[number]["value"];
const SORT_STORAGE_KEY = "pvia.reserves.sort";
const VIEW_STORAGE_KEY = "pvia.reserves.view";
const PAGE_SIZE = 30;

const reservesSearchSchema = z.object({
  status: fallback(z.enum(["all", ...STATUSES]), "all").default("all"),
  quick: fallback(z.enum(["all", "a_traiter", "en_cours", "validees", "bloquantes", "retard"]), "all").default("all"),
});

export const Route = createFileRoute("/_authenticated/reserves")({
  validateSearch: zodValidator(reservesSearchSchema),
  component: ReservesPage,
  head: () => ({ meta: [{ title: "Réserves — PVIA" }] }),
});

type Row = {
  id: string;
  description: string;
  severity: string;
  status: string;
  priority: string;
  created_at: string;
  pv_id: string;
  nature: string | null;
  work_to_execute: string | null;
  due_date: string | null;
  assigned_to: string | null;
  lifted_at: string | null;
  validated_at: string | null;
  company_id: string | null;
  pv: { numero: string; chantier_id: string | null; client_id: string | null } | null;
  chantier?: { id: string; nom: string; reference: string | null } | null;
  client?: { id: string; nom: string } | null;
};

type Member = { user_id: string; display_name: string };

function isOverdue(r: Row) {
  return !!r.due_date && new Date(r.due_date) < new Date() && r.status !== "validee" && r.status !== "levee";
}

function compareRows(a: Row, b: Row, sort: SortKey) {
  switch (sort) {
    case "recent":  return +new Date(b.created_at) - +new Date(a.created_at);
    case "oldest":  return +new Date(a.created_at) - +new Date(b.created_at);
    case "due_asc": {
      const av = a.due_date ? +new Date(a.due_date) : Number.POSITIVE_INFINITY;
      const bv = b.due_date ? +new Date(b.due_date) : Number.POSITIVE_INFINITY;
      return av - bv;
    }
    case "due_desc": {
      const av = a.due_date ? +new Date(a.due_date) : Number.NEGATIVE_INFINITY;
      const bv = b.due_date ? +new Date(b.due_date) : Number.NEGATIVE_INFINITY;
      return bv - av;
    }
    case "severity": {
      const w = (s: string) => (s === "majeure" ? 0 : 1);
      const d = w(a.severity) - w(b.severity);
      return d !== 0 ? d : +new Date(b.created_at) - +new Date(a.created_at);
    }
    case "status":  return (a.status ?? "").localeCompare(b.status ?? "");
    default:        return 0;
  }
}

/**
 * Synthetic per-company reserve reference R-#####.
 * Derived from the position of the reserve in the company-wide chronological list
 * (ascending by created_at). Stable as long as no historical reserve is deleted.
 */
function useReserveRefs(items: Row[]): Map<string, string> {
  return useMemo(() => {
    const sorted = [...items].sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
    const map = new Map<string, string>();
    sorted.forEach((r, i) => map.set(r.id, `R-${String(i + 1).padStart(5, "0")}`));
    return map;
  }, [items]);
}

function ReservesPage() {
  const { activeCompanyId, activeRole } = useCompany();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [items, setItems] = useState<Row[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [filter, setFilter] = useState<string>(search.status);
  const [quick, setQuick] = useState<string>(search.quick);
  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>(() => {
    if (typeof window === "undefined") return "recent";
    return ((window.localStorage.getItem(SORT_STORAGE_KEY) as SortKey | null) ?? "recent");
  });
  const isMobile = useIsMobile();
  const [view, setView] = useState<"cards" | "table" | "kanban">(() => {
    if (typeof window === "undefined") return "cards";
    return ((window.localStorage.getItem(VIEW_STORAGE_KEY) as any) ?? "cards");
  });
  // Mobile never shows Kanban or table (forces cards for legibility).
  const effectiveView: "cards" | "table" | "kanban" = isMobile ? "cards" : view;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignOpen, setAssignOpen] = useState<{ ids: string[] } | null>(null);
  const [assignUser, setAssignUser] = useState<string>("none");
  const [assignDue, setAssignDue] = useState<string>("");
  const [assignPriority, setAssignPriority] = useState<string>("keep");
  const [detail, setDetail] = useState<Row | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [overview, setOverview] = useState<Map<string, ReserveOverviewEntry>>(new Map());

  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem(SORT_STORAGE_KEY, sort);
  }, [sort]);
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem(VIEW_STORAGE_KEY, view);
  }, [view]);

  const canManage = activeRole && ["directeur", "responsable_exploitation", "conducteur_travaux"].includes(activeRole);
  const canDelete = activeRole && ["directeur", "responsable_exploitation"].includes(activeRole);

  const updateStatusFn = useServerFn(updateReserveStatus);
  const deleteFn = useServerFn(deleteReserve);
  const assignFn = useServerFn(assignReserve);
  const bulkFn = useServerFn(bulkUpdateReserves);
  const exportFn = useServerFn(exportReservesCsv);
  const overviewFn = useServerFn(listReservesOverview);

  const load = useCallback(async () => {
    if (!activeCompanyId) return;
    const { data, error } = await supabase
      .from("pv_reserves")
      .select(
        "id,description,severity,status,priority,created_at,pv_id,nature,work_to_execute,due_date,assigned_to,lifted_at,validated_at,company_id",
      )
      .eq("company_id", activeCompanyId)
      .order("created_at", { ascending: false });
    if (error) return toast.error(error.message);
    const rows = (data ?? []) as Omit<Row, "pv" | "chantier" | "client">[];
    const pvIds = Array.from(new Set(rows.map((r) => r.pv_id)));
    const { data: pvs } = pvIds.length
      ? await supabase.from("pv").select("id,numero,chantier_id,client_id").in("id", pvIds)
      : { data: [] };
    const pvMap = new Map((pvs ?? []).map((p) => [p.id, p]));
    const chantierIds = Array.from(new Set((pvs ?? []).map((p) => p.chantier_id).filter(Boolean) as string[]));
    const clientIds = Array.from(new Set((pvs ?? []).map((p) => p.client_id).filter(Boolean) as string[]));
    const [{ data: chs }, { data: cls }] = await Promise.all([
      chantierIds.length
        ? supabase.from("chantiers").select("id,nom,reference").in("id", chantierIds)
        : Promise.resolve({ data: [] as any }),
      clientIds.length
        ? supabase.from("clients").select("id,nom").in("id", clientIds)
        : Promise.resolve({ data: [] as any }),
    ]);
    const chMap = new Map<string, { id: string; nom: string; reference: string | null }>(
      (chs ?? []).map((c: any) => [c.id as string, { id: c.id, nom: c.nom, reference: c.reference ?? null }]),
    );
    const clMap = new Map<string, { id: string; nom: string }>(
      (cls ?? []).map((c: any) => [c.id as string, { id: c.id as string, nom: c.nom as string }]),
    );
    setItems(
      rows.map((r) => {
        const pv = pvMap.get(r.pv_id);
        return {
          ...r,
          pv: pv ? { numero: pv.numero, chantier_id: pv.chantier_id, client_id: pv.client_id } : null,
          chantier: pv?.chantier_id ? chMap.get(pv.chantier_id) ?? null : null,
          client: pv?.client_id ? clMap.get(pv.client_id) ?? null : null,
        };
      }),
    );
  }, [activeCompanyId]);

  useEffect(() => { load(); }, [load]);

  // Members
  useEffect(() => {
    if (!activeCompanyId) return;
    (async () => {
      const { data } = await supabase
        .from("company_members")
        .select("user_id,profile:profiles!company_members_user_id_fkey(full_name)")
        .eq("company_id", activeCompanyId)
        .eq("status", "active");
      setMembers(
        ((data ?? []) as any[])
          .filter((m) => m.user_id)
          .map((m) => ({
            user_id: m.user_id as string,
            display_name: (m.profile?.full_name as string | undefined) ?? "Membre",
          })),
      );
    })();
  }, [activeCompanyId]);

  // Batched overview (thumbnails + photo counts) for current items.
  useEffect(() => {
    if (!activeCompanyId || items.length === 0) {
      setOverview(new Map());
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // Limit to first 300 to keep payload small; rest will display without thumb.
        const ids = items.slice(0, 300).map((r) => r.id);
        const res = await overviewFn({ data: { companyId: activeCompanyId, reserveIds: ids } });
        if (cancelled) return;
        const m = new Map<string, ReserveOverviewEntry>();
        for (const e of res.entries) m.set(e.reserveId, e);
        setOverview(m);
      } catch {
        // Silent — overview is non-critical decoration.
      }
    })();
    return () => { cancelled = true; };
  }, [activeCompanyId, items, overviewFn]);

  const refs = useReserveRefs(items);
  const memberName = useCallback(
    (id: string | null) => (id ? members.find((m) => m.user_id === id)?.display_name ?? "Assigné" : null),
    [members],
  );

  async function setStatus(id: string, status: string) {
    if (!activeCompanyId) return;
    try {
      await updateStatusFn({ data: { companyId: activeCompanyId, id, status: status as Status } });
      setItems((rs) => rs.map((r) => (r.id === id ? { ...r, status } : r)));
      toast.success("Réserve mise à jour");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Mise à jour impossible");
    }
  }

  async function quickAssign(id: string, userId: string | null) {
    if (!activeCompanyId) return;
    try {
      await assignFn({ data: { companyId: activeCompanyId, id, assignedTo: userId } });
      setItems((rs) => rs.map((r) => (r.id === id ? { ...r, assigned_to: userId } : r)));
      toast.success("Responsable mis à jour");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Assignation impossible");
    }
  }

  async function remove(id: string) {
    if (!activeCompanyId) return;
    if (!confirm("Supprimer cette réserve ?")) return;
    try {
      await deleteFn({ data: { companyId: activeCompanyId, id } });
      setItems((rs) => rs.filter((r) => r.id !== id));
      setSelected((s) => { const n = new Set(s); n.delete(id); return n; });
      toast.success("Réserve supprimée");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Suppression impossible");
    }
  }

  async function doAssign() {
    if (!activeCompanyId || !assignOpen) return;
    try {
      const assignedTo = assignUser === "none" ? null : assignUser;
      const dueDate = assignDue || null;
      const priority = assignPriority === "keep" ? undefined : (assignPriority as "low" | "normal" | "high");
      for (const id of assignOpen.ids) {
        await assignFn({ data: { companyId: activeCompanyId, id, assignedTo, dueDate, priority } });
      }
      toast.success(`${assignOpen.ids.length} réserve(s) mises à jour`);
      setAssignOpen(null);
      setAssignUser("none");
      setAssignDue("");
      setAssignPriority("keep");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action impossible");
    }
  }

  async function bulkStatus(status: Status) {
    if (!activeCompanyId || selected.size === 0) return;
    try {
      await bulkFn({ data: { companyId: activeCompanyId, ids: [...selected], status } });
      toast.success(`${selected.size} réserve(s) mises à jour`);
      setSelected(new Set());
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action impossible");
    }
  }

  async function bulkRemove() {
    if (!activeCompanyId || selected.size === 0) return;
    if (!confirm(`Supprimer ${selected.size} réserve(s) ? Action irréversible.`)) return;
    try {
      const ids = [...selected];
      for (const id of ids) await deleteFn({ data: { companyId: activeCompanyId, id } });
      toast.success(`${ids.length} réserve(s) supprimée(s)`);
      setSelected(new Set());
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Suppression impossible");
    }
  }

  async function doExport(format: "csv" | "xlsx", onlySelected: boolean) {
    if (!activeCompanyId) return;
    try {
      const res = await exportFn({
        data: { companyId: activeCompanyId, ids: onlySelected ? [...selected] : undefined },
      });
      // CSV already uses ; separators; xlsx tag is a hint only — Excel opens UTF-8 CSV when prefixed with BOM.
      const content = "\uFEFF" + res.csv;
      const blob = new Blob([content], {
        type: format === "xlsx"
          ? "application/vnd.ms-excel;charset=utf-8"
          : "text/csv;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `reserves-${new Date().toISOString().slice(0, 10)}.${format === "xlsx" ? "xls" : "csv"}`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Export ${format.toUpperCase()} : ${res.count} réserve(s)`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export impossible");
    }
  }

  function exportPdf() {
    // Lightweight: open print dialog of current view. Browser-side, no extra dep.
    window.print();
  }

  // Filters + sort
  const filtered = useMemo(() => {
    const out = items.filter((r) => {
      if (filter !== "all" && r.status !== filter) return false;
      if (severity !== "all" && r.severity !== severity) return false;
      if (quick === "a_traiter" && r.status !== "ouverte") return false;
      if (quick === "en_cours" && r.status !== "en_cours") return false;
      if (quick === "validees" && r.status !== "validee") return false;
      if (quick === "bloquantes" && (r.severity !== "majeure" || ["validee", "rejetee"].includes(r.status))) return false;
      if (quick === "retard" && !isOverdue(r)) return false;
      if (query.trim()) {
        const q = query.toLowerCase();
        const ref = refs.get(r.id) ?? "";
        const hay = [
          r.description, r.nature, r.work_to_execute,
          r.pv?.numero, r.chantier?.nom, r.chantier?.reference,
          r.client?.nom, ref, memberName(r.assigned_to),
        ].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    return out.sort((a, b) => compareRows(a, b, sort));
  }, [items, filter, severity, quick, query, sort, refs, memberName]);

  // Reset pagination on filter changes
  useEffect(() => { setVisible(PAGE_SIZE); }, [filter, severity, quick, query, sort, view]);

  // Counters for the 5-KPI dashboard.
  const dash = useMemo(() => ({
    a_traiter: items.filter((r) => r.status === "ouverte").length,
    en_cours: items.filter((r) => r.status === "en_cours").length,
    validees: items.filter((r) => r.status === "validee").length,
    bloquantes: items.filter((r) => r.severity === "majeure" && !["validee", "rejetee"].includes(r.status)).length,
    retard: items.filter((r) => isOverdue(r)).length,
  }), [items]);

  const activeFilterCount =
    (filter !== "all" ? 1 : 0) + (severity !== "all" ? 1 : 0) + (quick !== "all" ? 1 : 0);

  function toggleQuick(k: string) {
    const next = quick === k ? "all" : k;
    setQuick(next);
    navigate({ search: (p: any) => ({ ...p, quick: next as any }) });
  }

  function toggleSelect(id: string) {
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function toggleAll() {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((r) => r.id)));
  }

  function resetFilters() {
    setFilter("all");
    setSeverity("all");
    setQuick("all");
    setQuery("");
    navigate({ search: () => ({ status: "all", quick: "all" }) as any });
  }

  const renderSeverity = (sev: string) => (
    <StatusPill tone={sev === "majeure" ? "destructive" : "neutral"} size="sm">{sev}</StatusPill>
  );
  const renderStatus = (s: string) => (
    <StatusPill tone={(STATUS_TONE[s as Status] ?? "neutral") as any} size="sm" dot>
      {STATUS_LABEL[s as Status] ?? s}
    </StatusPill>
  );

  // Infinite scroll sentinel
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible((n) => (n < filtered.length ? n + PAGE_SIZE : n));
      }
    }, { rootMargin: "200px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [filtered.length]);

  const visibleRows = filtered.slice(0, visible);

  const reserveDetail: ReserveDetail | null = detail
    ? {
        id: detail.id,
        description: detail.description,
        severity: detail.severity,
        status: detail.status,
        priority: detail.priority,
        nature: detail.nature,
        work_to_execute: detail.work_to_execute,
        due_date: detail.due_date,
        assigned_to: detail.assigned_to,
        assigned_name: memberName(detail.assigned_to),
        lifted_at: detail.lifted_at,
        validated_at: detail.validated_at,
        created_at: detail.created_at,
        pv_id: detail.pv_id,
        company_id: detail.company_id,
      }
    : null;

  // KPI dashboard config
  const KPIS: Array<{
    k: string; label: string; v: number; Icon: any; tone: string; activeBg: string;
  }> = [
    { k: "a_traiter", label: "À traiter", v: dash.a_traiter, Icon: AlertTriangle, tone: "border-amber-400/60 text-amber-600", activeBg: "bg-amber-50 dark:bg-amber-950/30" },
    { k: "en_cours", label: "En cours", v: dash.en_cours, Icon: Clock, tone: "border-orange-400/60 text-orange-600", activeBg: "bg-orange-50 dark:bg-orange-950/30" },
    { k: "validees", label: "Validées", v: dash.validees, Icon: ShieldCheck, tone: "border-emerald-400/60 text-emerald-600", activeBg: "bg-emerald-50 dark:bg-emerald-950/30" },
    { k: "bloquantes", label: "Bloquantes", v: dash.bloquantes, Icon: ShieldAlert, tone: "border-red-400/60 text-red-600", activeBg: "bg-red-50 dark:bg-red-950/30" },
    { k: "retard", label: "En retard", v: dash.retard, Icon: CalendarClock, tone: "border-rose-400/60 text-rose-600", activeBg: "bg-rose-50 dark:bg-rose-950/30" },
  ];

  // Drag-and-drop for Kanban
  const [dragId, setDragId] = useState<string | null>(null);
  async function onKanbanDrop(targetStatus: Status) {
    if (!dragId) return;
    const id = dragId;
    setDragId(null);
    const r = items.find((x) => x.id === id);
    if (!r || r.status === targetStatus) return;
    await setStatus(id, targetStatus);
  }

  return (
    <div className="space-y-3 pb-28">
      {/* ───── Compact header (mobile-friendly) ───── */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold sm:text-2xl">Réserves</h1>
          <p className="truncate text-xs text-muted-foreground sm:text-sm">
            {items.length} réserve{items.length > 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button asChild size="sm" className="shrink-0">
            <Link to="/pv">
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Nouvelle réserve</span>
            </Link>
          </Button>
        </div>
      </div>

      {/* ───── KPI dashboard ───── */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {KPIS.map(({ k, label, v, Icon, tone, activeBg }) => {
          const active = quick === k;
          return (
            <button
              key={k}
              onClick={() => toggleQuick(k)}
              className={`flex items-center gap-2 rounded-xl border-2 ${tone} p-3 text-left transition ${
                active ? "border-primary bg-primary/10 ring-2 ring-primary text-primary" : `bg-card hover:${activeBg}`
              }`}
            >
              <Icon className={`h-5 w-5 shrink-0 ${active ? "text-primary" : ""}`} />
              <div className="min-w-0">
                <div className="text-xl font-bold leading-tight">{v}</div>
                <div className={`truncate text-[11px] ${active ? "text-primary" : "text-muted-foreground"}`}>{label}</div>
              </div>
            </button>
          );
        })}
      </div>

      {/* ───── Sticky search + filters ───── */}
      <div className="sticky top-0 z-20 -mx-2 bg-background/95 px-2 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/70 sm:static sm:mx-0 sm:bg-transparent sm:p-0">
        <Card className="flex flex-wrap items-center gap-2 p-2">
          <div className="relative min-w-[180px] flex-1">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Réf, chantier, client, PV, technicien, commentaire…"
              className="h-9 pl-8"
            />
          </div>

          {/* Desktop filters */}
          <div className="hidden gap-2 md:flex">
            <Select value={filter} onValueChange={(v) => { setFilter(v); navigate({ search: (p: any) => ({ ...p, status: v as any }) }); }}>
              <SelectTrigger className="h-9 w-40"><SelectValue placeholder="Statut" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous statuts</SelectItem>
                {STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={severity} onValueChange={setSeverity}>
              <SelectTrigger className="h-9 w-36"><SelectValue placeholder="Gravité" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes gravités</SelectItem>
                <SelectItem value="mineure">Mineure</SelectItem>
                <SelectItem value="majeure">Majeure</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Sort */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="h-9">
                <ArrowUpDown className="h-4 w-4" />
                <span className="hidden sm:inline">{SORT_OPTIONS.find((o) => o.value === sort)?.label ?? "Trier"}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Trier par</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {SORT_OPTIONS.map((o) => (
                <DropdownMenuItem key={o.value} onClick={() => setSort(o.value)}>
                  {sort === o.value ? "✓ " : ""}{o.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Mobile filters trigger */}
          <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
            <SheetTrigger asChild>
              <Button size="sm" variant="outline" className="h-9 md:hidden">
                <SlidersHorizontal className="h-4 w-4" />
                {activeFilterCount > 0 && (
                  <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">{activeFilterCount}</Badge>
                )}
              </Button>
            </SheetTrigger>
            <SheetContent side="bottom" className="rounded-t-2xl">
              <SheetHeader><SheetTitle>Filtres</SheetTitle></SheetHeader>
              <div className="space-y-3 py-3">
                <div>
                  <label className="mb-1 block text-xs font-medium">Statut</label>
                  <Select value={filter} onValueChange={(v) => { setFilter(v); navigate({ search: (p: any) => ({ ...p, status: v as any }) }); }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Tous statuts</SelectItem>
                      {STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">Gravité</label>
                  <Select value={severity} onValueChange={setSeverity}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Toutes</SelectItem>
                      <SelectItem value="mineure">Mineure</SelectItem>
                      <SelectItem value="majeure">Majeure</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <SheetFooter className="flex-row gap-2">
                <Button variant="outline" className="flex-1" onClick={resetFilters}>Réinitialiser</Button>
                <Button className="flex-1" onClick={() => setFiltersOpen(false)}>Voir résultats</Button>
              </SheetFooter>
            </SheetContent>
          </Sheet>

          {/* Desktop view toggle */}
          <div className="ml-auto hidden gap-1 md:flex">
            <Button size="sm" variant={view === "cards" ? "default" : "outline"} onClick={() => setView("cards")} title="Cartes">
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button size="sm" variant={view === "kanban" ? "default" : "outline"} onClick={() => setView("kanban")} title="Kanban">
              <Kanban className="h-4 w-4" />
            </Button>
            <Button size="sm" variant={view === "table" ? "default" : "outline"} onClick={() => setView("table")} title="Tableau">
              <TableIcon className="h-4 w-4" />
            </Button>
          </div>

          {/* Export menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="h-9">
                <Download className="h-4 w-4" />
                <span className="hidden sm:inline">Export</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => doExport("csv", false)}>
                <FileSpreadsheet className="h-4 w-4" /> CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => doExport("xlsx", false)}>
                <FileSpreadsheet className="h-4 w-4" /> Excel
              </DropdownMenuItem>
              <DropdownMenuItem onClick={exportPdf}>
                <Printer className="h-4 w-4" /> PDF (impression)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Card>

        {activeFilterCount > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1 text-xs">
            <Filter className="h-3 w-3 text-muted-foreground" />
            <span className="text-muted-foreground">{filtered.length} résultat(s)</span>
            <button onClick={resetFilters} className="ml-auto text-primary hover:underline">Effacer</button>
          </div>
        )}
      </div>

      {/* ───── Bulk action bar ───── */}
      {selected.size > 0 && canManage && (
        <Card className="sticky bottom-2 z-30 flex flex-wrap items-center gap-2 border-primary/30 bg-primary/5 p-2 shadow-lg">
          <Badge variant="secondary">{selected.size} sélectionnée(s)</Badge>
          <Button size="sm" variant="outline" onClick={() => setAssignOpen({ ids: [...selected] })}>
            <UserPlus className="h-4 w-4" /> Assigner / Échéance / Priorité
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline">Statut…</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {STATUSES.map((s) => (
                <DropdownMenuItem key={s} onClick={() => bulkStatus(s)}>{STATUS_LABEL[s]}</DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" variant="outline" onClick={() => doExport("csv", true)}>
            <FileSpreadsheet className="h-4 w-4" /> CSV
          </Button>
          <Button size="sm" variant="outline" onClick={() => doExport("xlsx", true)}>
            <FileSpreadsheet className="h-4 w-4" /> Excel
          </Button>
          <Button size="sm" variant="outline" onClick={exportPdf}>
            <Printer className="h-4 w-4" /> PDF
          </Button>
          {canDelete && (
            <Button size="sm" variant="outline" className="text-destructive" onClick={bulkRemove}>
              <Trash2 className="h-4 w-4" /> Supprimer
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            <X className="h-4 w-4" />
          </Button>
        </Card>
      )}

      {/* ───── Body ───── */}
      {filtered.length === 0 ? (
        items.length === 0 ? (
          <Card className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
            <AlertCircle className="h-7 w-7 opacity-40" />
            <p>Aucune réserve enregistrée pour l'instant.</p>
          </Card>
        ) : (
          <Card className="flex flex-col items-center gap-2 p-6 text-center text-sm text-muted-foreground">
            <p>Aucun résultat pour ces filtres.</p>
            <Button size="sm" variant="outline" onClick={resetFilters}>Réinitialiser</Button>
          </Card>
        )
      ) : effectiveView === "kanban" ? (
        /* ───── Kanban ───── */
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3 xl:grid-cols-5">
          {(["ouverte", "en_cours", "levee", "validee", "rejetee"] as Status[]).map((col) => {
            const rows = filtered.filter((r) => r.status === col);
            return (
              <div
                key={col}
                onDragOver={(e) => { e.preventDefault(); }}
                onDrop={() => onKanbanDrop(col)}
                className="flex min-h-[200px] flex-col gap-2 rounded-lg border border-dashed border-border bg-muted/30 p-2"
              >
                <div className="flex items-center justify-between px-1">
                  <span className="text-xs font-semibold uppercase tracking-wide">{STATUS_LABEL[col]}</span>
                  <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{rows.length}</Badge>
                </div>
                <div className="flex flex-col gap-2">
                  {rows.map((r) => (
                    <KanbanCard
                      key={r.id}
                      r={r}
                      reference={refs.get(r.id) ?? ""}
                      overview={overview.get(r.id)}
                      onOpen={() => setDetail(r)}
                      onDragStart={() => setDragId(r.id)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : effectiveView === "table" ? (
        <Card className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox checked={selected.size === filtered.length && filtered.length > 0} onCheckedChange={toggleAll} />
                </TableHead>
                <TableHead>Réf</TableHead>
                <TableHead>PV</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Chantier</TableHead>
                <TableHead>Gravité</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Échéance</TableHead>
                <TableHead>Responsable</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.map((r) => {
                const overdue = isOverdue(r);
                return (
                  <TableRow
                    key={r.id}
                    className={`cursor-pointer ${overdue ? "bg-red-50/40 dark:bg-red-950/10" : ""}`}
                    onClick={() => setDetail(r)}
                  >
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggleSelect(r.id)} />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{refs.get(r.id)}</TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Link to="/pv/$id" params={{ id: r.pv_id }} className="text-primary hover:underline">
                        {r.pv?.numero}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs">{r.client?.nom ?? "—"}</TableCell>
                    <TableCell className="text-xs">{r.chantier?.nom ?? "—"}</TableCell>
                    <TableCell>{renderSeverity(r.severity)}</TableCell>
                    <TableCell>{renderStatus(r.status)}</TableCell>
                    <TableCell className={`text-xs ${overdue ? "font-semibold text-red-600" : ""}`}>
                      {r.due_date ? new Date(r.due_date).toLocaleDateString("fr-FR") : "—"}
                    </TableCell>
                    <TableCell className="text-xs" onClick={(e) => e.stopPropagation()}>
                      <Select
                        value={r.assigned_to ?? "none"}
                        onValueChange={(v) => quickAssign(r.id, v === "none" ? null : v)}
                      >
                        <SelectTrigger className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">— Aucun —</SelectItem>
                          {members.map((m) => (
                            <SelectItem key={m.user_id} value={m.user_id}>{m.display_name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1">
                        {canManage && (
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setAssignOpen({ ids: [r.id] })}>
                            <UserPlus className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {canDelete && (
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => remove(r.id)}>
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      ) : (
        /* ───── Cards (default) ───── */
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {visibleRows.map((r) => (
            <ReserveCard
              key={r.id}
              r={r}
              reference={refs.get(r.id) ?? ""}
              overview={overview.get(r.id)}
              members={members}
              memberName={memberName(r.assigned_to)}
              selected={selected.has(r.id)}
              canManage={!!canManage}
              canDelete={!!canDelete}
              onToggleSelect={() => toggleSelect(r.id)}
              onOpen={() => setDetail(r)}
              onQuickAssign={(uid) => quickAssign(r.id, uid)}
              onLever={() => navigate({ to: "/pv/$id", params: { id: r.pv_id }, search: { openLift: r.id } as any })}
              onAssign={() => setAssignOpen({ ids: [r.id] })}
              onRemove={() => remove(r.id)}
              renderSeverity={renderSeverity}
              renderStatus={renderStatus}
            />
          ))}
        </div>
      )}

      {/* Infinite scroll sentinel */}
      {effectiveView !== "kanban" && visible < filtered.length && (
        <div ref={sentinelRef} className="flex justify-center py-4 text-xs text-muted-foreground">
          Chargement… ({filtered.length - visible} restantes)
        </div>
      )}

      {/* Detail dialog */}
      <ReserveDetailDialog
        open={!!reserveDetail}
        onOpenChange={(o) => !o && setDetail(null)}
        reserve={reserveDetail}
        onChanged={() => { load(); }}
        onLever={(rsv) => {
          navigate({ to: "/pv/$id", params: { id: rsv.pv_id }, search: { openLift: rsv.id } as any });
        }}
      />

      {/* Assign / due date / priority dialog */}
      <Dialog open={!!assignOpen} onOpenChange={(o) => !o && setAssignOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mettre à jour {assignOpen?.ids.length ?? 0} réserve(s)</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Responsable</label>
              <Select value={assignUser} onValueChange={setAssignUser}>
                <SelectTrigger><SelectValue placeholder="Aucun" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Aucun —</SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.user_id} value={m.user_id}>{m.display_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Échéance</label>
              <Input type="date" value={assignDue} onChange={(e) => setAssignDue(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Priorité</label>
              <Select value={assignPriority} onValueChange={setAssignPriority}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="keep">— Inchangée —</SelectItem>
                  <SelectItem value="low">Basse</SelectItem>
                  <SelectItem value="normal">Normale</SelectItem>
                  <SelectItem value="high">Haute</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(null)}>Annuler</Button>
            <Button onClick={doAssign}>Appliquer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────── */

function ReserveCard({
  r, reference, overview, members, memberName, selected, canManage, canDelete,
  onToggleSelect, onOpen, onQuickAssign, onLever, onAssign, onRemove,
  renderSeverity, renderStatus,
}: {
  r: Row;
  reference: string;
  overview?: ReserveOverviewEntry;
  members: Member[];
  memberName: string | null;
  selected: boolean;
  canManage: boolean;
  canDelete: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
  onQuickAssign: (uid: string | null) => void;
  onLever: () => void;
  onAssign: () => void;
  onRemove: () => void;
  renderSeverity: (s: string) => any;
  renderStatus: (s: string) => any;
}) {
  const overdue = isOverdue(r);
  const photos = (overview?.initialCount ?? 0) + (overview?.beforeCount ?? 0) + (overview?.afterCount ?? 0);
  return (
    <Card
      onClick={onOpen}
      className={`flex cursor-pointer flex-col gap-2 p-2.5 transition hover:border-primary/40 hover:shadow-md ${overdue ? "border-red-500/50" : ""}`}
    >
      {/* Top row: checkbox + ref + status + severity */}
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2" onClick={(e) => e.stopPropagation()}>
        <Checkbox checked={selected} onCheckedChange={onToggleSelect} />
        <div className="min-w-0 truncate font-mono text-xs font-semibold text-primary">{reference}</div>
        <div className="flex shrink-0 items-center gap-1">
          {renderSeverity(r.severity)}
          {renderStatus(r.status)}
        </div>
      </div>

      {/* Body with optional thumbnail */}
      <div className="flex gap-2">
        {overview?.thumbUrl && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onOpen(); }}
            className="block h-16 w-16 shrink-0 overflow-hidden rounded border border-border"
            aria-label="Voir les photos"
          >
            <img
              src={overview.thumbUrl}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
            />
          </button>
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <p className="line-clamp-2 text-sm leading-snug">{r.description}</p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
            {r.chantier && (
              <span className="truncate">
                🏗 {r.chantier.reference ? <span className="font-mono">{r.chantier.reference}</span> : r.chantier.nom}
              </span>
            )}
            {r.client && <span className="truncate">👤 {r.client.nom}</span>}
            {r.pv?.numero && <span className="truncate font-mono">📄 {r.pv.numero}</span>}
          </div>
          {(memberName || r.due_date) && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
              {memberName && <span className="truncate">👷 {memberName}</span>}
              {r.due_date && (
                <span className={overdue ? "font-semibold text-red-600" : ""}>
                  📅 {new Date(r.due_date).toLocaleDateString("fr-FR")}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Badges (single horizontal line, no wrap-on-mobile beyond 1 line, no horizontal scroll) */}
      <div className="flex flex-wrap items-center gap-1 text-[10px]">
        {photos > 0 && (
          <Badge variant="secondary" className="gap-0.5 px-1.5 py-0">
            <ImageIcon className="h-3 w-3" /> {photos}
          </Badge>
        )}
        {(overview?.beforeCount ?? 0) > 0 && (
          <Badge variant="outline" className="border-amber-400/60 px-1.5 py-0 text-amber-700">Avant {overview!.beforeCount}</Badge>
        )}
        {(overview?.afterCount ?? 0) > 0 && (
          <Badge variant="outline" className="border-emerald-400/60 px-1.5 py-0 text-emerald-700">Après {overview!.afterCount}</Badge>
        )}
        {(overview?.liftCount ?? 0) > 0 && (
          <Badge variant="outline" className="border-blue-400/60 px-1.5 py-0 text-blue-700">
            <FileCheck2 className="mr-0.5 h-3 w-3" /> Levée
          </Badge>
        )}
        {r.priority === "high" && (
          <Badge className="bg-red-600 px-1.5 py-0 text-white">
            <Flag className="mr-0.5 h-3 w-3" /> Haute
          </Badge>
        )}
      </div>

      {/* Quick assign + actions row */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-1.5 pt-0.5" onClick={(e) => e.stopPropagation()}>
        {canManage ? (
          <Select value={r.assigned_to ?? "none"} onValueChange={(v) => onQuickAssign(v === "none" ? null : v)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Responsable" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— Aucun —</SelectItem>
              {members.map((m) => (
                <SelectItem key={m.user_id} value={m.user_id}>{m.display_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : <div />}
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onOpen} title="Modifier / détail">
          <Pencil className="h-4 w-4" />
        </Button>
        {r.status !== "validee" && r.status !== "levee" && (
          <Button size="sm" variant="outline" className="h-8" onClick={onLever}>
            <CheckCircle2 className="h-3.5 w-3.5" /> Lever
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" className="h-8 w-8" title="Plus">
              <HistoryIcon className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onOpen}>
              <HistoryIcon className="h-4 w-4" /> Historique
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/pv/$id" params={{ id: r.pv_id }} className="cursor-pointer">
                <ExternalLink className="h-4 w-4" /> Ouvrir le PV
              </Link>
            </DropdownMenuItem>
            {canManage && (
              <DropdownMenuItem onClick={onAssign}>
                <UserPlus className="h-4 w-4" /> Assignation détaillée
              </DropdownMenuItem>
            )}
            {canDelete && (
              <DropdownMenuItem onClick={onRemove} className="text-destructive">
                <Trash2 className="h-4 w-4" /> Supprimer
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </Card>
  );
}

/* Compact Kanban card with native HTML5 drag */
function KanbanCard({
  r, reference, overview, onOpen, onDragStart,
}: {
  r: Row;
  reference: string;
  overview?: ReserveOverviewEntry;
  onOpen: () => void;
  onDragStart: () => void;
}) {
  const overdue = isOverdue(r);
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onOpen}
      className={`cursor-grab rounded border bg-card p-2 text-xs shadow-sm transition active:cursor-grabbing hover:border-primary/40 ${
        overdue ? "border-red-500/50" : "border-border"
      }`}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="font-mono font-semibold text-primary">{reference}</span>
        <StatusPill tone={r.severity === "majeure" ? "destructive" : "neutral"} size="sm">{r.severity}</StatusPill>
      </div>
      <p className="mt-1 line-clamp-2 text-[12px] leading-snug">{r.description}</p>
      <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
        {r.chantier?.reference && <span className="font-mono">{r.chantier.reference}</span>}
        {r.due_date && (
          <span className={overdue ? "font-semibold text-red-600" : ""}>
            📅 {new Date(r.due_date).toLocaleDateString("fr-FR")}
          </span>
        )}
        {overview?.thumbUrl && (
          <span className="ml-auto inline-flex items-center gap-0.5">
            <ImageIcon className="h-3 w-3" />
          </span>
        )}
      </div>
    </div>
  );
}

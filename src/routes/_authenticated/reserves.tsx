import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useCallback } from "react";
import {
  AlertCircle, ExternalLink, Trash2, Filter, CheckCircle2, Search,
  Download, LayoutGrid, Table as TableIcon, UserPlus, X,
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
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useIsMobile } from "@/hooks/use-mobile";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { StatusPill } from "@/components/ui/status-pill";
import { PageHeader } from "@/components/app/PageHeader";
import { useCompany } from "@/hooks/use-company";
import { useServerFn } from "@tanstack/react-start";
import {
  updateReserveStatus, deleteReserve, assignReserve,
  bulkUpdateReserves, exportReservesCsv,
} from "@/lib/reserves.functions";
import { getReserveCounters } from "@/lib/reserve-counters";
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

const reservesSearchSchema = z.object({
  status: fallback(z.enum(["all", ...STATUSES]), "all").default("all"),
  quick: fallback(z.enum(["all", "ouvertes", "bloquantes", "retard", "a_lever", "validees"]), "all").default("all"),
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
  pv: { numero: string; chantier_id: string | null; client_id: string | null } | null;
  chantier?: { id: string; nom: string } | null;
  client?: { id: string; nom: string } | null;
};

type Member = { user_id: string; display_name: string };

function isOverdue(r: Row) {
  return !!r.due_date && new Date(r.due_date) < new Date() && r.status !== "validee" && r.status !== "levee";
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
  const isMobile = useIsMobile();
  const [view, setView] = useState<"cards" | "table">("cards");
  const effectiveView: "cards" | "table" = isMobile ? "cards" : view;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignOpen, setAssignOpen] = useState<{ ids: string[] } | null>(null);
  const [assignUser, setAssignUser] = useState<string>("none");
  const [assignDue, setAssignDue] = useState<string>("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const canManage = activeRole && ["directeur", "responsable_exploitation", "conducteur_travaux"].includes(activeRole);
  const canDelete = activeRole && ["directeur", "responsable_exploitation"].includes(activeRole);

  const updateStatusFn = useServerFn(updateReserveStatus);
  const deleteFn = useServerFn(deleteReserve);
  const assignFn = useServerFn(assignReserve);
  const bulkFn = useServerFn(bulkUpdateReserves);
  const exportFn = useServerFn(exportReservesCsv);

  const load = useCallback(async () => {
    if (!activeCompanyId) return;
    const { data, error } = await supabase
      .from("pv_reserves")
      .select(
        "id,description,severity,status,priority,created_at,pv_id,nature,work_to_execute,due_date,assigned_to,lifted_at,validated_at",
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
      chantierIds.length ? supabase.from("chantiers").select("id,nom").in("id", chantierIds) : Promise.resolve({ data: [] as any }),
      clientIds.length ? supabase.from("clients").select("id,nom").in("id", clientIds) : Promise.resolve({ data: [] as any }),
    ]);
    const chMap = new Map<string, { id: string; nom: string }>(
      (chs ?? []).map((c: any) => [c.id as string, { id: c.id as string, nom: c.nom as string }]),
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
      for (const id of assignOpen.ids) {
        await assignFn({ data: { companyId: activeCompanyId, id, assignedTo, dueDate } });
      }
      toast.success(`${assignOpen.ids.length} réserve(s) assignée(s)`);
      setAssignOpen(null);
      setAssignUser("none");
      setAssignDue("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Assignation impossible");
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

  async function doExport(onlySelected: boolean) {
    if (!activeCompanyId) return;
    try {
      const res = await exportFn({
        data: { companyId: activeCompanyId, ids: onlySelected ? [...selected] : undefined },
      });
      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `reserves-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Export : ${res.count} réserve(s)`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export impossible");
    }
  }

  // Filters
  const filtered = useMemo(() => {
    return items.filter((r) => {
      if (filter !== "all" && r.status !== filter) return false;
      if (severity !== "all" && r.severity !== severity) return false;
      if (quick === "ouvertes" && r.status !== "ouverte") return false;
      if (quick === "bloquantes" && r.severity !== "majeure") return false;
      if (quick === "retard" && !isOverdue(r)) return false;
      if (quick === "a_lever" && !["ouverte", "en_cours"].includes(r.status)) return false;
      if (quick === "validees" && r.status !== "validee") return false;
      if (query.trim()) {
        const q = query.toLowerCase();
        const hay = [r.description, r.nature, r.work_to_execute, r.pv?.numero, r.chantier?.nom, r.client?.nom]
          .filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, filter, severity, quick, query]);

  const counters = useMemo(() => getReserveCounters(items), [items]);
  const dash = useMemo(() => ({
    ouvertes: counters.ouvertes,
    bloquantes: counters.bloquantes,
    retard: counters.enRetard,
    a_valider: counters.enAttenteValidation + counters.levees,
    validees: counters.validees,
  }), [counters]);

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

  const renderSeverity = (sev: string) => (
    <StatusPill tone={sev === "majeure" ? "destructive" : "neutral"} size="sm">{sev}</StatusPill>
  );
  const renderStatus = (s: string) => (
    <StatusPill tone={(STATUS_TONE[s as Status] ?? "neutral") as any} size="sm" dot>
      {STATUS_LABEL[s as Status] ?? s}
    </StatusPill>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Réserves de chantier"
        description={`${items.length} réserve(s) au total`}
        contained={false}
        className="border-0 bg-transparent px-0 py-0"
        actions={
          <Button size="sm" variant="outline" onClick={() => doExport(false)}>
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        }
      />

      {/* Dashboard cards */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[
          { k: "ouvertes", label: "Ouvertes", v: dash.ouvertes, tone: "border-destructive/40" },
          { k: "bloquantes", label: "Bloquantes", v: dash.bloquantes, tone: "border-orange-400/50" },
          { k: "retard", label: "En retard", v: dash.retard, tone: "border-red-500/50" },
          { k: "a_valider", label: "À valider", v: dash.a_valider, tone: "border-yellow-500/50" },
          { k: "validees", label: "Validées", v: dash.validees, tone: "border-green-500/50" },
        ].map((c) => (
          <button
            key={c.k}
            onClick={() => toggleQuick(c.k)}
            className={`rounded-lg border-2 ${c.tone} bg-card p-3 text-left transition hover:bg-accent ${
              quick === c.k ? "ring-2 ring-primary" : ""
            }`}
          >
            <div className="text-2xl font-semibold">{c.v}</div>
            <div className="text-xs text-muted-foreground">{c.label}</div>
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <Card className="flex flex-wrap items-center gap-2 p-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher (description, PV, chantier, client…)"
            className="h-9 pl-8"
          />
        </div>
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
        <div className="ml-auto hidden gap-1 md:flex">
          <Button size="sm" variant={view === "cards" ? "default" : "outline"} onClick={() => setView("cards")}>
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button size="sm" variant={view === "table" ? "default" : "outline"} onClick={() => setView("table")}>
            <TableIcon className="h-4 w-4" />
          </Button>
        </div>
      </Card>

      {/* Bulk actions */}
      {selected.size > 0 && canManage && (
        <Card className="flex flex-wrap items-center gap-2 border-primary/30 bg-primary/5 p-2">
          <Badge variant="secondary">{selected.size} sélectionnée(s)</Badge>
          <Button size="sm" variant="outline" onClick={() => bulkStatus("levee")}>
            <CheckCircle2 className="h-4 w-4" /> Marquer levées
          </Button>
          <Button size="sm" variant="outline" onClick={() => setAssignOpen({ ids: [...selected] })}>
            <UserPlus className="h-4 w-4" /> Assigner
          </Button>
          <Button size="sm" variant="outline" onClick={() => doExport(true)}>
            <Download className="h-4 w-4" /> Export sélection
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            <X className="h-4 w-4" />
          </Button>
        </Card>
      )}

      {filtered.length === 0 ? (
        items.length === 0 ? (
          <Card className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
            <AlertCircle className="h-7 w-7 opacity-40" />
            <p>Aucune réserve enregistrée pour l'instant.</p>
          </Card>
        ) : (
          <p className="px-1 text-xs text-muted-foreground">Aucun résultat pour ces filtres.</p>
        )
      ) : effectiveView === "cards" ? (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((r) => {
            const overdue = isOverdue(r);
            const isExpanded = expanded.has(r.id);
            return (
              <Card key={r.id} className={`flex flex-col gap-2 p-3 ${overdue ? "border-red-500/50" : ""}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggleSelect(r.id)} />
                    <Link to="/pv/$id" params={{ id: r.pv_id }} className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                      PV {r.pv?.numero} <ExternalLink className="h-3 w-3" />
                    </Link>
                  </div>
                  <div className="flex items-center gap-1">
                    {renderSeverity(r.severity)}
                    {renderStatus(r.status)}
                  </div>
                </div>
                {r.nature && <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{r.nature}</div>}
                <p className={`text-sm leading-snug ${isExpanded ? "" : "line-clamp-2"}`}>{r.description}</p>
                {r.description.length > 100 && (
                  <button onClick={() => setExpanded((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} className="text-left text-xs text-primary hover:underline">
                    {isExpanded ? "Voir moins" : "Voir plus"}
                  </button>
                )}
                {r.work_to_execute && (
                  <p className="line-clamp-1 text-xs text-muted-foreground"><span className="font-medium">Travaux :</span> {r.work_to_execute}</p>
                )}
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  {r.chantier && <span>🏗 {r.chantier.nom}</span>}
                  {r.client && <span>👤 {r.client.nom}</span>}
                  {r.assigned_to && <span>👷 {memberName(r.assigned_to)}</span>}
                  {r.due_date && (
                    <span className={overdue ? "font-semibold text-red-600" : ""}>
                      📅 {new Date(r.due_date).toLocaleDateString("fr-FR")}
                      {overdue && " (retard)"}
                    </span>
                  )}
                </div>
                <div className="mt-auto flex items-center gap-1 pt-1">
                  {canManage && (
                    <Select value={r.status} onValueChange={(v) => setStatus(r.id, v)}>
                      <SelectTrigger className="h-8 flex-1 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                  {r.status === "ouverte" && (
                    <Link to="/pv/$id" params={{ id: r.pv_id }} search={{ openLift: r.id }}>
                      <Button size="sm" variant="outline" className="h-8">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Lever
                      </Button>
                    </Link>
                  )}
                  {canManage && (
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setAssignOpen({ ids: [r.id] })}>
                      <UserPlus className="h-4 w-4" />
                    </Button>
                  )}
                  {canDelete && (
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => remove(r.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox checked={selected.size === filtered.length && filtered.length > 0} onCheckedChange={toggleAll} />
                </TableHead>
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
              {filtered.map((r) => {
                const overdue = isOverdue(r);
                return (
                  <TableRow key={r.id} className={overdue ? "bg-red-50/40 dark:bg-red-950/10" : ""}>
                    <TableCell>
                      <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggleSelect(r.id)} />
                    </TableCell>
                    <TableCell>
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
                    <TableCell className="text-xs">{memberName(r.assigned_to) ?? "—"}</TableCell>
                    <TableCell className="text-right">
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
      )}

      {/* Assign dialog */}
      <Dialog open={!!assignOpen} onOpenChange={(o) => !o && setAssignOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assigner {assignOpen?.ids.length ?? 0} réserve(s)</DialogTitle>
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(null)}>Annuler</Button>
            <Button onClick={doAssign}>Assigner</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

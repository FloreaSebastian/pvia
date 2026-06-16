import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, Search, X, LayoutGrid, List, MapPin, Building2, CalendarRange, User, CalendarDays, ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { createChantier as createChantierFn, updateChantier as updateChantierFn, deleteChantier as deleteChantierFn } from "@/lib/chantiers.functions";
import { toast } from "sonner";
import { useCompany } from "@/hooks/use-company";
import { PageHeader } from "@/components/app/PageHeader";
import { StatusPill } from "@/components/ui/status-pill";
import { cn } from "@/lib/utils";
import { AddressAutocomplete, type AddressValue } from "@/components/pv/AddressAutocomplete";

export const Route = createFileRoute("/_authenticated/chantiers")({
  component: ChantiersPage,
  head: () => ({ meta: [{ title: "Chantiers — PVIA" }] }),
});

type Chantier = {
  id: string; name: string; address: string | null;
  address_line1: string | null; postal_code: string | null; city: string | null;
  latitude: number | null; longitude: number | null;
  type: string | null; status: string; client_id: string | null;
  start_date: string | null; end_date: string | null; description: string | null;
};
type Client = { id: string; name: string };

const TYPES = ["BTP", "Rénovation", "Photovoltaïque", "Climatisation", "Plomberie", "Électricité", "Construction"];
const STATUSES = [
  { value: "en_cours", label: "En cours" },
  { value: "termine", label: "Terminé" },
  { value: "receptionne", label: "Réceptionné" },
];

const FILTERS: Array<{ value: "all" | "en_cours" | "termine" | "receptionne"; label: string }> = [
  { value: "all", label: "Tous" },
  { value: "en_cours", label: "En cours" },
  { value: "termine", label: "Terminés" },
  { value: "receptionne", label: "Réceptionnés" },
];

function statusTone(s: string): "success" | "info" | "warning" {
  return s === "receptionne" ? "success" : s === "termine" ? "info" : "warning";
}

function fmtDate(d: string | null) {
  if (!d) return null;
  return new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

function ChantiersPage() {
  const { activeCompanyId, can } = useCompany();
  const [items, setItems] = useState<Chantier[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Chantier | null>(null);
  const empty = { name: "", address: "", address_line1: "", postal_code: "", city: "", latitude: null as number | null, longitude: null as number | null, type: "BTP", status: "en_cours", client_id: "", start_date: "", end_date: "", description: "" };
  const [form, setForm] = useState(empty);
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<(typeof FILTERS)[number]["value"]>("all");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [saving, setSaving] = useState(false);
  const canWrite = can("manage");
  const createFn = useServerFn(createChantierFn);
  const updateFn = useServerFn(updateChantierFn);
  const deleteFn = useServerFn(deleteChantierFn);

  async function load() {
    if (!activeCompanyId) return;
    const [a, b] = await Promise.all([
      supabase.from("chantiers").select("*").eq("company_id", activeCompanyId).order("created_at", { ascending: false }),
      supabase.from("clients").select("id,name").eq("company_id", activeCompanyId).order("name"),
    ]);
    setItems((a.data as Chantier[]) ?? []);
    setClients((b.data as Client[]) ?? []);
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activeCompanyId]);

  function openNew() { setEditing(null); setForm(empty); setOpen(true); }
  function openEdit(c: Chantier) {
    setEditing(c);
    setForm({
      name: c.name, address: c.address ?? "",
      address_line1: c.address_line1 ?? "", postal_code: c.postal_code ?? "",
      city: c.city ?? "", latitude: c.latitude ?? null, longitude: c.longitude ?? null,
      type: c.type ?? "BTP", status: c.status,
      client_id: c.client_id ?? "", start_date: c.start_date ?? "", end_date: c.end_date ?? "",
      description: c.description ?? "",
    });
    setOpen(true);
  }
  function pickAddress(v: AddressValue) {
    setForm((f) => ({
      ...f,
      address_line1: v.address || f.address_line1,
      postal_code: v.postalCode || f.postal_code,
      city: v.city || f.city,
      latitude: v.latitude, longitude: v.longitude,
      address: [v.address, [v.postalCode, v.city].filter(Boolean).join(" ")].filter(Boolean).join(", "),
    }));
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!activeCompanyId || saving) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        address: form.address,
        address_line1: form.address_line1,
        postal_code: form.postal_code,
        city: form.city,
        latitude: form.latitude,
        longitude: form.longitude,
        type: form.type,
        status: form.status as "en_cours" | "termine" | "receptionne",
        client_id: form.client_id || null,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        description: form.description,
      };
      if (editing) {
        await updateFn({ data: { companyId: activeCompanyId, id: editing.id, data: payload } });
        toast.success("Chantier modifié");
      } else {
        await createFn({ data: { companyId: activeCompanyId, data: payload } });
        toast.success("Chantier créé");
      }
      setOpen(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Échec de l'enregistrement");
    } finally {
      setSaving(false);
    }
  }
  async function remove(id: string) {
    if (!activeCompanyId) return;
    if (!confirm("Supprimer ce chantier ?")) return;
    try {
      await deleteFn({ data: { companyId: activeCompanyId, id } });
      toast.success("Supprimé");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Suppression impossible");
    }
  }

  const clientName = useMemo(() => {
    const m = new Map(clients.map((c) => [c.id, c.name]));
    return (id: string | null) => (id ? m.get(id) ?? null : null);
  }, [clients]);

  const counts = useMemo(() => {
    const base = { all: items.length, en_cours: 0, termine: 0, receptionne: 0 } as Record<string, number>;
    for (const c of items) base[c.status] = (base[c.status] ?? 0) + 1;
    return base;
  }, [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((c) => {
      if (statusFilter !== "all" && c.status !== statusFilter) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        (c.address ?? "").toLowerCase().includes(q) ||
        (c.type ?? "").toLowerCase().includes(q) ||
        (clientName(c.client_id) ?? "").toLowerCase().includes(q)
      );
    });
  }, [items, query, statusFilter, clientName]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Chantiers"
        description="Tous vos chantiers en un coup d'œil."
        contained={false}
        className="border-0 bg-transparent px-0 py-0"
        actions={
          canWrite ? (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button onClick={openNew} className="shadow-brand">
                  <Plus className="h-4 w-4" /> Nouveau chantier
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader><DialogTitle>{editing ? "Modifier le chantier" : "Nouveau chantier"}</DialogTitle></DialogHeader>
                <form onSubmit={save} className="space-y-3">
                  <div><Label>Nom *</Label><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Type</Label>
                      <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Statut</Label>
                      <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{STATUSES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <Label>Client</Label>
                    <Select value={form.client_id || "none"} onValueChange={(v) => setForm({ ...form, client_id: v === "none" ? "" : v })}>
                      <SelectTrigger><SelectValue placeholder="Aucun" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Aucun</SelectItem>
                        {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Adresse</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Début</Label><Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></div>
                    <div><Label>Fin prévue</Label><Input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></div>
                  </div>
                  <div><Label>Description</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
                  <DialogFooter><Button type="submit" className="shadow-brand" disabled={saving}>{saving ? "…" : "Enregistrer"}</Button></DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          ) : null
        }
      />

      {/* Filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => {
          const active = statusFilter === f.value;
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => setStatusFilter(f.value)}
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition",
                active
                  ? "border-primary bg-primary text-primary-foreground shadow-brand"
                  : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
              )}
            >
              {f.label}
              <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] tabular-nums", active ? "bg-primary-foreground/20" : "bg-muted")}>
                {counts[f.value] ?? 0}
              </span>
            </button>
          );
        })}
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un chantier, client, adresse…"
            className="h-10 pl-9 pr-9"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted"
              aria-label="Effacer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs tabular-nums text-muted-foreground">
            {filtered.length} chantier{filtered.length > 1 ? "s" : ""}
          </span>
          <div className="inline-flex rounded-lg border border-border bg-card p-1">
            <button
              type="button"
              onClick={() => setView("grid")}
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition",
                view === "grid" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
              aria-label="Vue grille"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setView("list")}
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition",
                view === "list" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
              aria-label="Vue liste"
            >
              <List className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Empty state */}
      {filtered.length === 0 && (
        <Card className="flex flex-col items-center justify-center gap-3 p-12 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary">
            <Building2 className="h-6 w-6" />
          </div>
          <div>
            <p className="font-medium">
              {query || statusFilter !== "all" ? "Aucun résultat" : "Aucun chantier"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {query || statusFilter !== "all"
                ? "Affinez votre recherche ou changez de filtre."
                : "Créez votre premier chantier pour commencer."}
            </p>
          </div>
          {canWrite && !query && statusFilter === "all" && (
            <Button onClick={openNew} className="mt-2 shadow-brand">
              <Plus className="h-4 w-4" /> Nouveau chantier
            </Button>
          )}
        </Card>
      )}

      {/* Grid view */}
      {filtered.length > 0 && view === "grid" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => {
            const cn_ = clientName(c.client_id);
            const start = fmtDate(c.start_date);
            const end = fmtDate(c.end_date);
            return (
              <Card
                key={c.id}
                className="group relative flex flex-col gap-3 p-5 transition hover:-translate-y-0.5 hover:shadow-brand"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 shrink-0 text-primary" />
                      <p className="truncate font-semibold leading-tight">{c.name}</p>
                    </div>
                    {c.address && (
                      <p className="mt-1 flex items-start gap-1 text-xs text-muted-foreground">
                        <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
                        <span className="line-clamp-2">{c.address}</span>
                      </p>
                    )}
                  </div>
                  <StatusPill tone={statusTone(c.status)} dot>
                    {STATUSES.find((s) => s.value === c.status)?.label ?? c.status}
                  </StatusPill>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {c.type && <StatusPill tone="neutral">{c.type}</StatusPill>}
                  {cn_ && (
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <User className="h-3 w-3" /> {cn_}
                    </span>
                  )}
                </div>

                {(start || end) && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <CalendarRange className="h-3.5 w-3.5" />
                    <span>
                      {start ?? "?"} <span className="opacity-60">→</span> {end ?? "en cours"}
                    </span>
                  </div>
                )}

                {canWrite && (
                  <div className="mt-auto flex justify-end gap-1 opacity-0 transition group-hover:opacity-100">
                    <Button size="icon" variant="ghost" onClick={() => openEdit(c)} aria-label="Modifier">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => remove(c.id)} aria-label="Supprimer">
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* List view */}
      {filtered.length > 0 && view === "list" && (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nom</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Adresse</TableHead>
                <TableHead className="w-[100px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((c) => (
                <TableRow key={c.id} className="group">
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell>{c.type ? <StatusPill tone="neutral">{c.type}</StatusPill> : <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell>
                    <StatusPill tone={statusTone(c.status)} dot>
                      {STATUSES.find((s) => s.value === c.status)?.label ?? c.status}
                    </StatusPill>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{clientName(c.client_id) ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{c.address || "—"}</TableCell>
                  <TableCell className="text-right">
                    {canWrite && (
                      <div className="inline-flex opacity-60 transition group-hover:opacity-100">
                        <Button size="icon" variant="ghost" onClick={() => openEdit(c)} aria-label="Modifier">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => remove(c.id)} aria-label="Supprimer">
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

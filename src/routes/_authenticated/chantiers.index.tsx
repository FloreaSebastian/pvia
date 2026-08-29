import { WriteAccessGate, LockedActionButton, useWriteAccess } from "@/components/billing/WriteAccessGate";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, Search, X, LayoutGrid, List, MapPin, Building2, CalendarRange, User, ArrowRight, SlidersHorizontal, MoreHorizontal } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useContainerWidth } from "@/hooks/use-viewport";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
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

import { StatusPill } from "@/components/ui/status-pill";
import { cn } from "@/lib/utils";
import { AddressAutocomplete, type AddressValue } from "@/components/pv/AddressAutocomplete";

export const Route = createFileRoute("/_authenticated/chantiers/")({
  component: ChantiersPage,
  head: () => ({ meta: [{ title: "Chantiers — PVIA" }] }),
});

type Chantier = {
  id: string; reference: string; name: string; address: string | null;
  address_line1: string | null; postal_code: string | null; city: string | null;
  latitude: number | null; longitude: number | null;
  type: string | null; status: string; client_id: string | null;
  start_date: string | null; end_date: string | null; description: string | null;
  color: string | null; progress_percent: number;
};
type Client = { id: string; name: string };

const TYPES = ["BTP", "Rénovation", "Photovoltaïque", "Climatisation", "Plomberie", "Électricité", "Construction"];
const STATUSES = [
  { value: "preparation", label: "Préparation" },
  { value: "planifie", label: "Planifié" },
  { value: "en_cours", label: "En cours" },
  { value: "en_attente", label: "En attente" },
  { value: "receptionne", label: "Réceptionné" },
  { value: "termine", label: "Terminé" },
  { value: "archive", label: "Archivé" },
] as const;
type StatusValue = (typeof STATUSES)[number]["value"];
type FilterValue = "all" | StatusValue | "retard";

const FILTERS: Array<{ value: FilterValue; label: string }> = [
  { value: "all", label: "Tous" },
  ...STATUSES.map((s) => ({ value: s.value as FilterValue, label: s.label })),
  { value: "retard", label: "En retard" },
];

const CHANTIER_PALETTE = ["#3b82f6","#10b981","#f97316","#ef4444","#8b5cf6","#eab308","#0ea5e9","#14b8a6","#ec4899","#6b7280"];

function statusTone(s: string): "success" | "info" | "warning" | "neutral" {
  if (s === "receptionne") return "success";
  if (s === "termine" || s === "planifie") return "info";
  if (s === "en_cours" || s === "en_attente") return "warning";
  return "neutral"; // preparation, archive
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
  const empty = { name: "", address: "", address_line1: "", postal_code: "", city: "", latitude: null as number | null, longitude: null as number | null, type: "BTP", status: "planifie" as StatusValue, client_id: "", start_date: "", end_date: "", description: "", color: "" as string, progress_percent: 0 };
  const [form, setForm] = useState(empty);
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<(typeof FILTERS)[number]["value"]>("all");
  const [view, setView] = useState<"grid" | "list">("grid");
  // Largeur réellement disponible pour la page (container query), pas le viewport.
  const { ref: containerRef, width: containerWidth } = useContainerWidth<HTMLDivElement>();
  // Sous ce seuil, le tableau 7 colonnes n'est plus lisible : on bascule en liste compacte.
  const listCompact = containerWidth > 0 && containerWidth < 640;
  // Pointeur sans hover fiable (tactile) : les actions ne doivent pas dépendre de group-hover.
  const [coarsePointer, setCoarsePointer] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(hover: none), (pointer: coarse)");
    const sync = () => setCoarsePointer(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  const compactSpace = containerWidth > 0 && containerWidth < 520;
  const touchActions = coarsePointer || compactSpace;

  const [saving, setSaving] = useState(false);
  // Mesure la largeur réelle du formulaire (le Dialog n'est monté qu'à l'ouverture,
  // d'où un ref callback plutôt qu'un ref statique).
  const [formWidth, setFormWidth] = useState(0);
  const formRef = useCallback((node: HTMLFormElement | null) => {
    if (!node || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setFormWidth((prev) => (Math.abs(prev - w) > 1 ? w : prev));
    });
    ro.observe(node);
  }, []);
  const formCompact = formWidth > 0 && formWidth < 380;
  const canWrite = can("manage");
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const createFn = useServerFn(createChantierFn);
  const updateFn = useServerFn(updateChantierFn);
  const deleteFn = useServerFn(deleteChantierFn);

  const [openReservesCount, setOpenReservesCount] = useState(0);

  async function load() {
    if (!activeCompanyId) return;
    const [a, b, r] = await Promise.all([
      supabase.from("chantiers").select("*").eq("company_id", activeCompanyId).order("created_at", { ascending: false }),
      supabase.from("clients").select("id,name").eq("company_id", activeCompanyId).order("name"),
      supabase.from("pv_reserves").select("id", { count: "exact", head: true }).eq("company_id", activeCompanyId).eq("status", "ouverte"),
    ]);
    setItems((a.data as Chantier[]) ?? []);
    setClients((b.data as Client[]) ?? []);
    setOpenReservesCount(r.count ?? 0);
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activeCompanyId]);

  function openNew() { setEditing(null); setForm(empty); setOpen(true); }
  function openEdit(c: Chantier) {
    setEditing(c);
    setForm({
      name: c.name, address: c.address ?? "",
      address_line1: c.address_line1 ?? "", postal_code: c.postal_code ?? "",
      city: c.city ?? "", latitude: c.latitude ?? null, longitude: c.longitude ?? null,
      type: c.type ?? "BTP", status: (c.status as StatusValue) ?? "planifie",
      client_id: c.client_id ?? "", start_date: c.start_date ?? "", end_date: c.end_date ?? "",
      description: c.description ?? "",
      color: c.color ?? "",
      progress_percent: c.progress_percent ?? 0,
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
        status: form.status as StatusValue,
        client_id: form.client_id || null,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        description: form.description,
        color: form.color || null,
        progress_percent: form.progress_percent,
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

  // P2.7 — dashboard chantier
  const dashboard = useMemo(() => {
    const now = Date.now();
    let actifs = 0, receptionne = 0, termine = 0, enRetard = 0;
    for (const c of items) {
      if (c.status === "en_cours" || c.status === "en_attente") actifs++;
      if (c.status === "receptionne") receptionne++;
      if (c.status === "termine") termine++;
      if (c.end_date && new Date(c.end_date).getTime() < now
          && !["termine","receptionne","archive"].includes(c.status)) enRetard++;
    }
    return { actifs, receptionne, termine, enRetard };
  }, [items]);

  const counts = useMemo(() => {
    const base: Record<string, number> = { all: items.length, retard: dashboard.enRetard };
    for (const c of items) base[c.status] = (base[c.status] ?? 0) + 1;
    return base;
  }, [items, dashboard.enRetard]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const now = Date.now();
    return items.filter((c) => {
      if (statusFilter === "retard") {
        if (!c.end_date) return false;
        if (new Date(c.end_date).getTime() >= now) return false;
        if (["termine", "receptionne", "archive"].includes(c.status)) return false;
      } else if (statusFilter !== "all" && c.status !== statusFilter) {
        return false;
      }
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        (c.reference ?? "").toLowerCase().includes(q) ||
        (c.address ?? "").toLowerCase().includes(q) ||
        (c.type ?? "").toLowerCase().includes(q) ||
        (clientName(c.client_id) ?? "").toLowerCase().includes(q)
      );
    });
  }, [items, query, statusFilter, clientName]);

  return (
    <div ref={containerRef} className="space-y-3 overflow-x-hidden">

      {/* Compact header */}
      <Dialog open={open} onOpenChange={setOpen}>
        <header className="flex items-center justify-between gap-3 pt-1">
          <div className="min-w-0">
            <h1 className="font-display text-xl font-bold tracking-tight sm:text-2xl">Chantiers</h1>
            <p className="text-xs text-muted-foreground sm:text-sm">
              {items.length} chantier{items.length > 1 ? "s" : ""} au total
            </p>
          </div>
          {canWrite && (
            writeBlocked ? (
              <LockedActionButton label="Nouveau chantier" size="sm" className="h-10 shrink-0">
                Nouveau
              </LockedActionButton>
            ) : (
              <DialogTrigger asChild>
                <Button onClick={openNew} size="sm" className="h-10 shrink-0 shadow-brand">
                  <Plus className="h-4 w-4" />
                  <span>Nouveau</span>
                </Button>
              </DialogTrigger>
            )
          )}
        </header>

        {canWrite && (
                <DialogContent className="flex max-w-lg flex-col overflow-hidden">
                  <DialogHeader className="shrink-0"><DialogTitle>{editing ? "Modifier le chantier" : "Nouveau chantier"}</DialogTitle></DialogHeader>
                  <form ref={formRef} onSubmit={save} className="flex min-h-0 flex-1 flex-col gap-3">
                    <div className="-mx-4 min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 pb-2 sm:-mx-6 sm:px-6">
                    <div><Label htmlFor="ch-name">Nom *</Label><Input id="ch-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>

                    <div className={cn("grid gap-3", formCompact ? "grid-cols-1" : "grid-cols-2")}>
                      <div className="min-w-0">
                        <Label htmlFor="ch-type">Type</Label>
                        <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                          <SelectTrigger id="ch-type" className="w-full"><SelectValue /></SelectTrigger>
                          <SelectContent className="max-w-[calc(100vw-2rem)]">{TYPES.map((t) => <SelectItem key={t} value={t} className="min-h-11 sm:min-h-0">{t}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div className="min-w-0">
                        <Label htmlFor="ch-status">Statut</Label>
                        <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as StatusValue })}>
                          <SelectTrigger id="ch-status" className="w-full"><SelectValue /></SelectTrigger>
                          <SelectContent className="max-w-[calc(100vw-2rem)]">{STATUSES.map((t) => <SelectItem key={t.value} value={t.value} className="min-h-11 sm:min-h-0">{t.label}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="min-w-0">
                      <Label htmlFor="ch-client">Client</Label>
                      <Select value={form.client_id || "none"} onValueChange={(v) => setForm({ ...form, client_id: v === "none" ? "" : v })}>
                        <SelectTrigger id="ch-client" className="w-full"><SelectValue placeholder="Aucun" /></SelectTrigger>
                        <SelectContent className="max-w-[calc(100vw-2rem)]">
                          <SelectItem value="none" className="min-h-11 sm:min-h-0">Aucun</SelectItem>
                          {clients.map((c) => <SelectItem key={c.id} value={c.id} className="min-h-11 sm:min-h-0"><span className="block truncate">{c.name}</span></SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="min-w-0">
                      <Label htmlFor="ch-address">Adresse</Label>
                      <AddressAutocomplete
                        id="ch-address"
                        value={form.address_line1}
                        onChange={(v) => setForm({ ...form, address_line1: v })}
                        onSelect={pickAddress}
                        placeholder="Tapez l'adresse du chantier…"
                      />
                    </div>
                    <div className={cn("grid gap-3", formCompact ? "grid-cols-1" : "grid-cols-3")}>
                      <div className="min-w-0"><Label htmlFor="ch-postal">Code postal</Label><Input id="ch-postal" inputMode="numeric" value={form.postal_code} onChange={(e) => setForm({ ...form, postal_code: e.target.value })} /></div>
                      <div className={cn("min-w-0", !formCompact && "col-span-2")}><Label htmlFor="ch-city">Ville</Label><Input id="ch-city" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
                    </div>
                    <div className={cn("grid gap-3", formCompact ? "grid-cols-1" : "grid-cols-2")}>
                      <div className="min-w-0"><Label htmlFor="ch-start">Début</Label><Input id="ch-start" type="date" className="w-full" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></div>
                      <div className="min-w-0"><Label htmlFor="ch-end">Fin prévue</Label><Input id="ch-end" type="date" className="w-full" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></div>
                    </div>
                    <div className={cn("grid gap-3", formCompact ? "grid-cols-1" : "grid-cols-2")}>
                      <div className="min-w-0">
                        <Label>Couleur du chantier</Label>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button type="button" onClick={() => setForm({ ...form, color: "" })}
                            className={cn("h-7 w-7 rounded-full border-2 text-[10px] text-muted-foreground", !form.color ? "border-primary bg-muted" : "border-border hover:border-primary/50")}
                            aria-label="Aucune couleur"
                          >—</button>
                          {CHANTIER_PALETTE.map((hex) => (
                            <button key={hex} type="button"
                              onClick={() => setForm({ ...form, color: hex })}
                              className={cn("h-7 w-7 rounded-full border-2 transition", form.color?.toLowerCase() === hex ? "border-foreground ring-2 ring-offset-1 ring-primary/40" : "border-border hover:scale-110")}
                              style={{ backgroundColor: hex }}
                              aria-label={hex}
                            />
                          ))}
                          <input type="color" value={form.color || "#3b82f6"} onChange={(e) => setForm({ ...form, color: e.target.value })} className="h-7 w-9 cursor-pointer rounded border border-border bg-transparent p-0" aria-label="Couleur personnalisée" />
                        </div>
                      </div>
                      <div className="min-w-0">
                        <Label>Avancement ({form.progress_percent}%)</Label>
                        <input type="range" min={0} max={100} step={5} value={form.progress_percent}
                          onChange={(e) => setForm({ ...form, progress_percent: Number(e.target.value) })}
                          className="mt-2 w-full accent-primary" />
                      </div>
                    </div>
                    <div className="min-w-0"><Label htmlFor="ch-desc">Description</Label><Textarea id="ch-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
                    </div>
                    <DialogFooter className="-mx-4 shrink-0 gap-2 border-t border-border/60 bg-background px-4 pb-[env(safe-area-inset-bottom)] pt-3 sm:mx-0 sm:border-0 sm:px-0 sm:pt-2">
                      <Button type="submit" className="w-full shadow-brand sm:w-auto" disabled={saving}>{saving ? "…" : "Enregistrer"}</Button>
                    </DialogFooter>
                  </form>

                </DialogContent>
        )}
      </Dialog>

      {/* Search bar with embedded view toggle */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher…"
          className="h-11 pl-9 pr-24"
        />
        <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-1">
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
              aria-label="Effacer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <div className="inline-flex rounded-md border border-border bg-card p-0.5">
            <button
              type="button"
              onClick={() => setView("grid")}
              className={cn(
                "inline-flex h-7 items-center rounded px-2 transition",
                view === "grid" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
              aria-label="Vue grille"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setView("list")}
              className={cn(
                "inline-flex h-7 items-center rounded px-2 transition",
                view === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
              aria-label="Vue liste"
            >
              <List className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Compact KPIs — 2-col grid on mobile, 4-col on sm+, no horizontal scroll */}
      <div className="auto-grid-sm">
        {[
          { key: "actifs", label: "Actifs", value: dashboard.actifs, filter: "en_cours" as FilterValue, tone: "border-warning/40 bg-warning/5" },
          { key: "termine", label: "Terminés", value: dashboard.termine, filter: "termine" as FilterValue, tone: "border-success/40 bg-success/5" },
          { key: "receptionne", label: "Réceptionnés", value: dashboard.receptionne, filter: "receptionne" as FilterValue, tone: "border-info/40 bg-info/5" },
          { key: "retard", label: "Retard", value: dashboard.enRetard, filter: "retard" as FilterValue, tone: "border-destructive/40 bg-destructive/5" },
        ].map((s) => {
          const active = statusFilter === s.filter;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => setStatusFilter(s.filter)}
              className={cn(
                "flex min-w-0 items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left transition hover:border-primary/40",
                s.tone,
                active && "border-primary ring-1 ring-primary/40"
              )}
            >
              <span className="truncate text-[11px] font-medium text-muted-foreground sm:text-xs">{s.label}</span>
              <span className="shrink-0 text-base font-semibold tabular-nums leading-none">{s.value}</span>
            </button>
          );
        })}
      </div>

      {/* Secondary filters + results count */}
      <div className="flex items-center gap-2">
        <Sheet open={showMoreFilters} onOpenChange={setShowMoreFilters}>
          <SheetTrigger asChild>
            <button
              type="button"
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition",
                statusFilter !== "all" && !["en_cours","termine","receptionne","retard"].includes(statusFilter)
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-dashed border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
              )}
            >
              <SlidersHorizontal className="h-3 w-3" />
              {statusFilter !== "all" && !["en_cours","termine","receptionne","retard"].includes(statusFilter)
                ? (STATUSES.find((s) => s.value === statusFilter)?.label ?? "Filtre")
                : "Plus de filtres"}
            </button>
          </SheetTrigger>
          {statusFilter !== "all" && (
            <button
              type="button"
              onClick={() => setStatusFilter("all")}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:border-primary/40 hover:text-foreground"
            >
              <X className="h-3 w-3" /> Effacer
            </button>
          )}
          <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
            {filtered.length} résultat{filtered.length > 1 ? "s" : ""}
          </span>
          <SheetContent side="bottom" className="rounded-t-2xl">
            <SheetHeader>
              <SheetTitle>Filtrer par statut</SheetTitle>
            </SheetHeader>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {[
                { value: "all" as FilterValue, label: "Tous" },
                { value: "preparation" as FilterValue, label: "Préparation" },
                { value: "planifie" as FilterValue, label: "Planifié" },
                { value: "en_attente" as FilterValue, label: "En attente" },
                { value: "archive" as FilterValue, label: "Archivé" },
              ].map((f) => {
                const active = statusFilter === f.value;
                return (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => { setStatusFilter(f.value); setShowMoreFilters(false); }}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition",
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card text-foreground hover:border-primary/40"
                    )}
                  >
                    <span>{f.label}</span>
                    <span className={cn("rounded-full px-1.5 text-[10px] tabular-nums", active ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground")}>
                      {counts[f.value] ?? 0}
                    </span>
                  </button>
                );
              })}
            </div>
          </SheetContent>
        </Sheet>
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
            <WriteAccessGate label="Nouveau chantier">
              <Button onClick={openNew} className="mt-2 shadow-brand">
                <Plus className="h-4 w-4" /> Nouveau chantier
              </Button>
            </WriteAccessGate>
          )}
        </Card>
      )}

      {/* Grid view */}
      {filtered.length > 0 && view === "grid" && (
        <div className="auto-grid-lg">
          {filtered.map((c) => {
            const cn_ = clientName(c.client_id);
            const start = fmtDate(c.start_date);
            const end = fmtDate(c.end_date);
            return (
              <Card
                key={c.id}
                onClick={() => navigate({ to: "/chantiers/$id", params: { id: c.id } })}
                className={`group relative flex cursor-pointer flex-col gap-3 overflow-hidden transition hover:-translate-y-0.5 hover:shadow-brand ${compactSpace ? "p-4" : "p-5"}`}
              >
                {c.color && <span aria-hidden className="absolute inset-y-0 left-0 w-1.5" style={{ backgroundColor: c.color }} />}
                {compactSpace ? (
                  /* Espace réduit : réf. + statut sur une ligne, nom sur 2 lignes en dessous. */
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <Building2 className="h-4 w-4 shrink-0 text-primary" />
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold text-foreground">{c.reference}</span>
                      <span className="ml-auto shrink-0">
                        <StatusPill tone={statusTone(c.status)} dot>
                          {STATUSES.find((s) => s.value === c.status)?.label ?? c.status}
                        </StatusPill>
                      </span>
                    </div>
                    <p className="line-clamp-2 text-sm font-semibold leading-snug">{c.name}</p>
                    {c.address && (
                      <p className="flex items-start gap-1 text-xs text-muted-foreground">
                        <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
                        <span className="line-clamp-2">{c.address}</span>
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 shrink-0 text-primary" />
                        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold text-foreground">{c.reference}</span>
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
                )}

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

                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>Avancement</span>
                    <span className="tabular-nums">{c.progress_percent ?? 0}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(0, Math.min(100, c.progress_percent ?? 0))}%`, backgroundColor: c.color || "hsl(var(--primary))" }} />
                  </div>
                </div>

                <div className="mt-auto flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1 text-xs text-primary opacity-70 group-hover:opacity-100">
                    Ouvrir la fiche <ArrowRight className="h-3 w-3" />
                  </span>
                  {canWrite && (
                    touchActions ? (
                      <RowActionsMenu onEdit={() => openEdit(c)} onDelete={() => remove(c.id)} label={c.name} />
                    ) : (
                      <div className="flex gap-1 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
                        <Button size="icon" variant="ghost" onClick={() => openEdit(c)} aria-label="Modifier">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => remove(c.id)} aria-label="Supprimer">
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    )
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* List view — liste compacte sous 720px de largeur disponible, tableau au-delà */}
      {filtered.length > 0 && view === "list" && listCompact && (
        <Card className="divide-y divide-border/60 overflow-hidden p-0">
          {filtered.map((c) => {
            const cn_ = clientName(c.client_id);
            return (
              <div
                key={c.id}
                role="button"
                tabIndex={0}
                onClick={() => navigate({ to: "/chantiers/$id", params: { id: c.id } })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    navigate({ to: "/chantiers/$id", params: { id: c.id } });
                  }
                }}
                className="relative flex w-full cursor-pointer items-start gap-2 px-3 py-3 text-left transition active:bg-muted/60"
              >
                {c.color && <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: c.color }} />}
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold">{c.reference}</span>
                    <StatusPill tone={statusTone(c.status)} dot>
                      {STATUSES.find((s) => s.value === c.status)?.label ?? c.status}
                    </StatusPill>
                  </div>
                  <p className="truncate text-sm font-semibold leading-tight">{c.name}</p>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    {c.type && <StatusPill tone="neutral">{c.type}</StatusPill>}
                    {cn_ && (
                      <span className="inline-flex min-w-0 items-center gap-1">
                        <User className="h-3 w-3 shrink-0" />
                        <span className="truncate">{cn_}</span>
                      </span>
                    )}
                  </div>
                  {c.address && (
                    <p className="flex items-start gap-1 text-xs text-muted-foreground">
                      <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
                      <span className="line-clamp-2">{c.address}</span>
                    </p>
                  )}
                </div>
                {canWrite && (
                  <RowActionsMenu onEdit={() => openEdit(c)} onDelete={() => remove(c.id)} label={c.name} />
                )}
              </div>
            );
          })}
        </Card>
      )}

      {filtered.length > 0 && view === "list" && !listCompact && (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Référence</TableHead>
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
                <TableRow key={c.id} className="group cursor-pointer" onClick={() => navigate({ to: "/chantiers/$id", params: { id: c.id } })}>
                  <TableCell className="font-mono text-xs font-semibold">{c.reference}</TableCell>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell>{c.type ? <StatusPill tone="neutral">{c.type}</StatusPill> : <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell>
                    <StatusPill tone={statusTone(c.status)} dot>
                      {STATUSES.find((s) => s.value === c.status)?.label ?? c.status}
                    </StatusPill>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{clientName(c.client_id) ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{c.address || "—"}</TableCell>
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    {canWrite && (
                      touchActions ? (
                        <RowActionsMenu onEdit={() => openEdit(c)} onDelete={() => remove(c.id)} label={c.name} />
                      ) : (
                        <div className="inline-flex opacity-60 transition focus-within:opacity-100 group-hover:opacity-100">
                          <Button size="icon" variant="ghost" onClick={() => openEdit(c)} aria-label="Modifier">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => remove(c.id)} aria-label="Supprimer">
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      )
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

/**
 * Menu d'actions tactile (Modifier / Supprimer).
 * Utilisé dès que le pointeur n'a pas de hover fiable ou que l'espace est étroit :
 * aucune action critique ne dépend alors de `group-hover`.
 */
function RowActionsMenu({ onEdit, onDelete, label }: { onEdit: () => void; onDelete: () => void; label?: string }) {
  return (
    <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="h-11 w-11"
            aria-label={label ? `Actions pour ${label}` : "Actions"}
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="h-5 w-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem className="min-h-11" onSelect={() => onEdit()}>
            <Pencil className="mr-2 h-4 w-4" /> Modifier
          </DropdownMenuItem>
          <DropdownMenuItem className="min-h-11 text-destructive focus:text-destructive" onSelect={() => onDelete()}>
            <Trash2 className="mr-2 h-4 w-4" /> Supprimer
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

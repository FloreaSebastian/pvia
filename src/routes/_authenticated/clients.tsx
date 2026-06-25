import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, Search, X, LayoutGrid, List, Mail, Phone, MapPin, Users, Building2, User, Archive, ArchiveRestore, Download, Sparkles, MoreVertical } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { createClient as createClientFn, updateClient as updateClientFn, archiveClient as archiveClientFn, restoreClient as restoreClientFn } from "@/lib/clients.functions";
import { toast } from "sonner";
import { useCompany } from "@/hooks/use-company";
import { PageHeader } from "@/components/app/PageHeader";
import { cn } from "@/lib/utils";
import { ClientTypeSelector, ClientFormFields, EMPTY_CLIENT_FORM, type ClientFormState } from "@/components/clients/ClientTypeForm";
import { ClientDetailDialog } from "@/components/clients/ClientDetailDialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { downloadClientsCsv } from "@/lib/clients-export";
import { ClientsImportDialog } from "@/components/clients/ClientsImportDialog";

export const Route = createFileRoute("/_authenticated/clients")({
  component: ClientsPage,
  head: () => ({ meta: [{ title: "Clients — PVIA" }] }),
});

type Client = {
  id: string; name: string; email: string | null; phone: string | null;
  address: string | null; address_line1: string | null; postal_code: string | null;
  city: string | null; latitude: number | null; longitude: number | null;
  notes: string | null; client_type: "particulier" | "entreprise" | null;
  company_name: string | null; siret: string | null; siren: string | null;
  vat_number: string | null; naf_code: string | null; contact_name: string | null;
  archived_at: string | null; archived_by: string | null; archive_reason: string | null;
};

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase() ?? "").join("");
}



function ClientsPage() {
  const { activeCompanyId, can } = useCompany();
  const [items, setItems] = useState<Client[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [form, setForm] = useState<ClientFormState>(EMPTY_CLIENT_FORM);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "particulier" | "entreprise">("all");
  const [scope, setScope] = useState<"active" | "archived">("active");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [saving, setSaving] = useState(false);
  const [detailClient, setDetailClient] = useState<Client | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<Client | null>(null);
  const [archiveReason, setArchiveReason] = useState("");
  const [archiving, setArchiving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const canWrite = can("manage");
  const canAdmin = can("admin");
  const createFn = useServerFn(createClientFn);
  const updateFn = useServerFn(updateClientFn);
  const archiveFn = useServerFn(archiveClientFn);
  const restoreFn = useServerFn(restoreClientFn);

  function openDetail(c: Client) {
    setDetailClient(c);
    setDetailOpen(true);
  }
  function handleEditFromDetail(c: Client) {
    setDetailOpen(false);
    openEdit(c);
  }
  function handleDeleteFromDetail(id: string) {
    setDetailOpen(false);
    const target = items.find((c) => c.id === id) ?? null;
    if (target) askArchive(target);
  }

  async function load() {
    if (!activeCompanyId) return;
    const { data } = await supabase
      .from("clients" as any)
      .select("*")
      .eq("company_id", activeCompanyId)
      .order("created_at", { ascending: false });
    setItems((data as unknown as Client[]) ?? []);
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activeCompanyId]);

  function openNew() {
    setEditing(null);
    setForm(EMPTY_CLIENT_FORM);
    setOpen(true);
  }
  function openEdit(c: Client) {
    setEditing(c);
    setForm({
      client_type: (c.client_type ?? "particulier") as "particulier" | "entreprise",
      name: c.name,
      email: c.email ?? "", phone: c.phone ?? "", notes: c.notes ?? "",
      address: c.address ?? "", address_line1: c.address_line1 ?? "",
      postal_code: c.postal_code ?? "", city: c.city ?? "",
      latitude: c.latitude ?? null, longitude: c.longitude ?? null,
      company_name: c.company_name ?? "", siret: c.siret ?? "", siren: c.siren ?? "",
      vat_number: c.vat_number ?? "", naf_code: c.naf_code ?? "",
      contact_name: c.contact_name ?? "",
    });
    setOpen(true);
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!activeCompanyId || saving) return;
    setSaving(true);
    try {
      if (editing) {
        await updateFn({ data: { companyId: activeCompanyId, id: editing.id, data: form } });
        toast.success("Client modifié");
      } else {
        await createFn({ data: { companyId: activeCompanyId, data: form } });
        toast.success("Client créé");
      }
      setOpen(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Échec de l'enregistrement");
    } finally {
      setSaving(false);
    }
  }
  function askArchive(c: Client) {
    setArchiveTarget(c);
    setArchiveReason("");
  }
  async function confirmArchive() {
    if (!activeCompanyId || !archiveTarget || archiving) return;
    setArchiving(true);
    try {
      await archiveFn({ data: { companyId: activeCompanyId, id: archiveTarget.id, reason: archiveReason.trim() || undefined } });
      toast.success("Client archivé");
      setArchiveTarget(null);
      setArchiveReason("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Archivage impossible");
    } finally {
      setArchiving(false);
    }
  }
  async function restore(c: Client) {
    if (!activeCompanyId) return;
    try {
      await restoreFn({ data: { companyId: activeCompanyId, id: c.id } });
      toast.success("Client restauré");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Restauration impossible");
    }
  }

  function exportCsv(target: "filtered" | "active" | "archived") {
    const today = new Date().toISOString().slice(0, 10);
    let rows: Client[];
    let name: string;
    if (target === "filtered") {
      rows = filtered;
      name = `clients-${scope}-${today}.csv`;
    } else if (target === "active") {
      rows = items.filter((c) => !c.archived_at);
      name = `clients-actifs-${today}.csv`;
    } else {
      rows = items.filter((c) => !!c.archived_at);
      name = `clients-archives-${today}.csv`;
    }
    if (rows.length === 0) {
      toast.info("Aucun client à exporter");
      return;
    }
    downloadClientsCsv(rows, name);
    toast.success(`Export de ${rows.length} client${rows.length > 1 ? "s" : ""}`);
  }




  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((c) => {
      const isArchived = !!c.archived_at;
      if (scope === "active" && isArchived) return false;
      if (scope === "archived" && !isArchived) return false;
      if (typeFilter !== "all" && (c.client_type ?? "particulier") !== typeFilter) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        (c.email ?? "").toLowerCase().includes(q) ||
        (c.phone ?? "").toLowerCase().includes(q) ||
        (c.address ?? "").toLowerCase().includes(q) ||
        (c.city ?? "").toLowerCase().includes(q) ||
        (c.company_name ?? "").toLowerCase().includes(q) ||
        (c.siret ?? "").toLowerCase().includes(q) ||
        (c.siren ?? "").toLowerCase().includes(q)
      );
    });
  }, [items, query, typeFilter, scope]);
  const archivedCount = useMemo(() => items.filter((c) => !!c.archived_at).length, [items]);

  function TypeBadge({ type }: { type: Client["client_type"] }) {
    const isEnt = type === "entreprise";
    return (
      <Badge variant="outline" className={cn("gap-1 text-[10px]", isEnt ? "border-blue-500/40 text-blue-600 dark:text-blue-400" : "border-emerald-500/40 text-emerald-600 dark:text-emerald-400")}>
        {isEnt ? <Building2 className="h-3 w-3" /> : <User className="h-3 w-3" />}
        {isEnt ? "Entreprise" : "Particulier"}
      </Badge>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Compact mobile header */}
      <div className="sm:hidden">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold tracking-tight">Clients</h1>
          {canWrite && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm" onClick={openNew} className="h-9 shadow-brand"><Plus className="h-4 w-4" /> Nouveau</Button>
              </DialogTrigger>
              <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
                <DialogHeader><DialogTitle>{editing ? "Modifier le client" : "Nouveau client"}</DialogTitle></DialogHeader>
                <form onSubmit={save} className="space-y-4">
                  <div className="space-y-2">
                    <Label>Type de client</Label>
                    <ClientTypeSelector value={form.client_type} onChange={(v) => setForm({ ...form, client_type: v })} disabled={!!editing} />
                  </div>
                  <ClientFormFields form={form} setForm={setForm} />
                  <div><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
                  <DialogFooter><Button type="submit" className="shadow-brand" disabled={saving}>{saving ? "…" : "Enregistrer"}</Button></DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">{filtered.length} client{filtered.length > 1 ? "s" : ""}</p>
      </div>

      {/* Desktop header */}
      <div className="hidden sm:block">
        <PageHeader
          title="Clients"
          description="Gérez votre carnet d'adresses."
          contained={false}
          className="border-0 bg-transparent px-0 py-0"
          actions={
            canWrite ? (
              <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild>
                  <Button onClick={openNew} className="shadow-brand"><Plus className="h-4 w-4" /> Nouveau client</Button>
                </DialogTrigger>
                <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
                  <DialogHeader><DialogTitle>{editing ? "Modifier le client" : "Nouveau client"}</DialogTitle></DialogHeader>
                  <form onSubmit={save} className="space-y-4">
                    <div className="space-y-2">
                      <Label>Type de client</Label>
                      <ClientTypeSelector value={form.client_type} onChange={(v) => setForm({ ...form, client_type: v })} disabled={!!editing} />
                    </div>
                    <ClientFormFields form={form} setForm={setForm} />
                    <div><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
                    <DialogFooter><Button type="submit" className="shadow-brand" disabled={saving}>{saving ? "…" : "Enregistrer"}</Button></DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            ) : null
          }
        />
      </div>

      {/* Toolbar */}
      <div className="space-y-2 sm:flex sm:items-center sm:justify-between sm:gap-3 sm:space-y-0">
        <div className="relative w-full sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher nom, société, SIRET..." className="h-10 pl-9 pr-9" />
          {query && (
            <button type="button" onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="Effacer">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {(canAdmin || archivedCount > 0) && (
            <div className="inline-flex rounded-lg border border-border bg-card p-1">
              {([
                { v: "active" as const, l: "Actifs" },
                { v: "archived" as const, l: `Archives${archivedCount ? ` (${archivedCount})` : ""}` },
              ]).map(({ v, l }) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setScope(v)}
                  className={cn(
                    "inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition",
                    scope === v ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                  aria-pressed={scope === v}
                >
                  {v === "archived" && <Archive className="h-3.5 w-3.5" />} {l}
                </button>
              ))}
            </div>
          )}
          <div className="inline-flex w-full rounded-lg border border-border bg-card p-1 sm:w-auto">
            {([
              { v: "all" as const, l: "Tous" },
              { v: "particulier" as const, l: "Particuliers" },
              { v: "entreprise" as const, l: "Entreprises" },
            ]).map(({ v, l }) => (
              <button key={v} type="button" onClick={() => setTypeFilter(v)}
                className={cn("h-7 flex-1 rounded-md px-2 text-xs font-medium transition sm:flex-none",
                  typeFilter === v ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                {l}
              </button>
            ))}
          </div>
          <span className="hidden text-xs tabular-nums text-muted-foreground sm:inline">{filtered.length}</span>
          {canWrite && (
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => setImportOpen(true)} aria-label="Importer des clients avec l'IA">
              <Sparkles className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Import IA</span>
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5" aria-label="Exporter les clients">
                <Download className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Exporter</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Exporter en CSV</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => exportCsv("filtered")}>
                Vue actuelle ({filtered.length})
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => exportCsv("active")}>
                Tous les clients actifs
              </DropdownMenuItem>
              {(canAdmin || archivedCount > 0) && (
                <DropdownMenuItem onSelect={() => exportCsv("archived")}>
                  Clients archivés ({archivedCount})
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="hidden rounded-lg border border-border bg-card p-1 sm:inline-flex">
            <button type="button" onClick={() => setView("grid")} className={cn("inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition", view === "grid" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")} aria-label="Vue grille">
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={() => setView("list")} className={cn("inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition", view === "list" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")} aria-label="Vue liste">
              <List className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>


      {filtered.length === 0 && (
        <Card className="flex flex-col items-center justify-center gap-3 p-12 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary"><Users className="h-6 w-6" /></div>
          <div>
            <p className="font-medium">{query || typeFilter !== "all" ? "Aucun résultat" : "Aucun client"}</p>
            <p className="mt-1 text-sm text-muted-foreground">{query ? "Essayez une autre recherche." : "Créez votre premier client pour commencer."}</p>
          </div>
          {canWrite && !query && typeFilter === "all" && (
            <Button onClick={openNew} className="mt-2 shadow-brand"><Plus className="h-4 w-4" /> Nouveau client</Button>
          )}
        </Card>
      )}

      {filtered.length > 0 && view === "grid" && (
        <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
          {filtered.map((c) => {
            const isEnt = c.client_type === "entreprise";
            const Icon = isEnt ? Building2 : User;
            return (
            <Card key={c.id} onClick={() => openDetail(c)} className="group relative flex cursor-pointer flex-col gap-2.5 p-4 transition duration-150 hover:-translate-y-0.5 hover:shadow-brand active:scale-[0.99] sm:gap-3 sm:p-5">
              <div className="flex items-start gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-gradient text-primary-foreground shadow-brand sm:h-11 sm:w-11">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold leading-tight sm:text-base">{c.name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <TypeBadge type={c.client_type} />
                  </div>
                  {isEnt && c.siret && <p className="mt-1 font-mono text-[11px] text-muted-foreground">SIRET {c.siret}</p>}
                  {isEnt && c.contact_name && <p className="mt-0.5 text-xs text-muted-foreground truncate">Contact : {c.contact_name}</p>}
                </div>
                {canWrite && (
                  <div className="-mr-1 -mt-1 flex shrink-0 sm:opacity-0 sm:transition sm:group-hover:opacity-100">
                    {c.archived_at ? (
                      canAdmin && (
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); restore(c); }} aria-label="Restaurer"><ArchiveRestore className="h-4 w-4 text-primary" /></Button>
                      )
                    ) : (
                      <>
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); openEdit(c); }} aria-label="Modifier"><Pencil className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); askArchive(c); }} aria-label="Archiver"><Archive className="h-4 w-4 text-destructive" /></Button>
                      </>
                    )}
                  </div>
                )}
              </div>
              <div className="space-y-1 text-xs sm:text-sm">
                {c.email && (<a href={`mailto:${c.email}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-2 truncate text-muted-foreground hover:text-foreground"><Mail className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{c.email}</span></a>)}
                {c.phone && (<a href={`tel:${c.phone}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-2 truncate text-muted-foreground hover:text-foreground"><Phone className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{c.phone}</span></a>)}
                {c.city && (<p className="flex items-center gap-2 truncate text-muted-foreground"><MapPin className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{c.city}</span></p>)}
                {!c.email && !c.phone && !c.city && (<p className="text-xs italic text-muted-foreground">Aucun contact renseigné</p>)}
              </div>
            </Card>
            );
          })}
        </div>
      )}


      {filtered.length > 0 && view === "list" && (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nom</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>SIRET</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Téléphone</TableHead>
                <TableHead>Ville</TableHead>
                <TableHead className="w-[100px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((c) => (
                <TableRow key={c.id} onClick={() => openDetail(c)} className="group cursor-pointer">
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-3">
                      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-gradient text-xs font-semibold text-primary-foreground">{initials(c.name) || "?"}</div>
                      <span className="truncate">{c.name}</span>
                    </div>
                  </TableCell>
                  <TableCell><TypeBadge type={c.client_type} /></TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{c.siret || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{c.email || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{c.phone || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{c.city || "—"}</TableCell>
                  <TableCell className="text-right">
                    {canWrite && (
                      <div className="inline-flex opacity-60 transition group-hover:opacity-100">
                        {c.archived_at ? (
                          canAdmin && (
                            <Button size="icon" variant="ghost" onClick={(e) => { e.stopPropagation(); restore(c); }} aria-label="Restaurer"><ArchiveRestore className="h-4 w-4 text-primary" /></Button>
                          )
                        ) : (
                          <>
                            <Button size="icon" variant="ghost" onClick={(e) => { e.stopPropagation(); openEdit(c); }} aria-label="Modifier"><Pencil className="h-4 w-4" /></Button>
                            <Button size="icon" variant="ghost" onClick={(e) => { e.stopPropagation(); askArchive(c); }} aria-label="Archiver"><Archive className="h-4 w-4 text-destructive" /></Button>
                          </>
                        )}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <ClientDetailDialog
        client={detailClient}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onEdit={handleEditFromDetail}
        onDelete={handleDeleteFromDetail}
      />

      <Dialog open={!!archiveTarget} onOpenChange={(v) => { if (!v) { setArchiveTarget(null); setArchiveReason(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Archiver ce client ?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground">{archiveTarget?.name}</span> ne sera plus visible dans la liste principale.
              Tous les PV, chantiers, réserves et documents liés sont conservés. Un administrateur pourra le restaurer à tout moment.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="archive-reason">Motif (optionnel)</Label>
              <Textarea
                id="archive-reason"
                rows={3}
                maxLength={500}
                value={archiveReason}
                onChange={(e) => setArchiveReason(e.target.value)}
                placeholder="Ex. Doublon, client inactif, fin de contrat…"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setArchiveTarget(null); setArchiveReason(""); }} disabled={archiving}>Annuler</Button>
            <Button variant="destructive" onClick={confirmArchive} disabled={archiving}>
              <Archive className="h-4 w-4" /> {archiving ? "Archivage…" : "Archiver"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {activeCompanyId && (
        <ClientsImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          companyId={activeCompanyId}
          onImported={load}
        />
      )}
    </div>
  );
}

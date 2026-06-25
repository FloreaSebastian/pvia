import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, Search, X, LayoutGrid, List, Mail, Phone, MapPin, Users, Building2, User } from "lucide-react";
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
import { createClient as createClientFn, updateClient as updateClientFn, deleteClient as deleteClientFn } from "@/lib/clients.functions";
import { toast } from "sonner";
import { useCompany } from "@/hooks/use-company";
import { PageHeader } from "@/components/app/PageHeader";
import { cn } from "@/lib/utils";
import { ClientTypeSelector, ClientFormFields, EMPTY_CLIENT_FORM, type ClientFormState } from "@/components/clients/ClientTypeForm";

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
  const [view, setView] = useState<"grid" | "list">("grid");
  const [saving, setSaving] = useState(false);
  const canWrite = can("manage");
  const createFn = useServerFn(createClientFn);
  const updateFn = useServerFn(updateClientFn);
  const deleteFn = useServerFn(deleteClientFn);

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
  async function remove(id: string) {
    if (!activeCompanyId) return;
    if (!confirm("Supprimer ce client ?")) return;
    try {
      await deleteFn({ data: { companyId: activeCompanyId, id } });
      toast.success("Supprimé");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Suppression impossible");
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((c) => {
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
  }, [items, query, typeFilter]);

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
    <div className="space-y-6">
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

      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Nom, email, téléphone, ville, SIRET, SIREN…" className="h-10 pl-9 pr-9" />
          {query && (
            <button type="button" onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="Effacer">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-border bg-card p-1">
            {([
              { v: "all" as const, l: "Tous" },
              { v: "particulier" as const, l: "Particuliers" },
              { v: "entreprise" as const, l: "Entreprises" },
            ]).map(({ v, l }) => (
              <button key={v} type="button" onClick={() => setTypeFilter(v)}
                className={cn("h-7 rounded-md px-2 text-xs font-medium transition",
                  typeFilter === v ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                {l}
              </button>
            ))}
          </div>
          <span className="text-xs tabular-nums text-muted-foreground">{filtered.length}</span>
          <div className="inline-flex rounded-lg border border-border bg-card p-1">
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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => (
            <Card key={c.id} className="group relative flex flex-col gap-3 p-5 transition hover:-translate-y-0.5 hover:shadow-brand">
              <div className="flex items-start gap-3">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-gradient text-sm font-semibold text-primary-foreground shadow-brand">
                  {initials(c.name) || "?"}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2"><p className="truncate font-semibold leading-tight">{c.name}</p></div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <TypeBadge type={c.client_type} />
                    {c.siret && <Badge variant="outline" className="font-mono text-[10px]">SIRET {c.siret}</Badge>}
                  </div>
                  {c.contact_name && <p className="mt-1 text-xs text-muted-foreground">Contact : {c.contact_name}</p>}
                  {c.address && (<p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground"><MapPin className="h-3 w-3 shrink-0" /> {c.address}</p>)}
                </div>
              </div>
              <div className="space-y-1.5 text-sm">
                {c.email && (<a href={`mailto:${c.email}`} className="flex items-center gap-2 truncate text-muted-foreground hover:text-foreground"><Mail className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{c.email}</span></a>)}
                {c.phone && (<a href={`tel:${c.phone}`} className="flex items-center gap-2 truncate text-muted-foreground hover:text-foreground"><Phone className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{c.phone}</span></a>)}
                {!c.email && !c.phone && (<p className="text-xs italic text-muted-foreground">Aucun contact renseigné</p>)}
              </div>
              {canWrite && (
                <div className="mt-auto flex justify-end gap-1 opacity-0 transition group-hover:opacity-100">
                  <Button size="icon" variant="ghost" onClick={() => openEdit(c)} aria-label="Modifier"><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => remove(c.id)} aria-label="Supprimer"><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
              )}
            </Card>
          ))}
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
                <TableRow key={c.id} className="group">
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
                        <Button size="icon" variant="ghost" onClick={() => openEdit(c)} aria-label="Modifier"><Pencil className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" onClick={() => remove(c.id)} aria-label="Supprimer"><Trash2 className="h-4 w-4 text-destructive" /></Button>
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

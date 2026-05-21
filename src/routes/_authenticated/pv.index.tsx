import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Plus, Download, Trash2, FileText, Search, X, ListFilter } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useCompany } from "@/hooks/use-company";
import { PvStatusPill } from "@/components/ui/status-pill";
import { PageHeader } from "@/components/app/PageHeader";

export const Route = createFileRoute("/_authenticated/pv/")({
  component: PvList,
  head: () => ({ meta: [{ title: "Procès-verbaux — PVIA" }] }),
});

type Pv = { id: string; numero: string; type: string; status: string; reception_date: string | null; created_at: string; pdf_url: string | null };

const FILTERS = [
  { id: "all", label: "Tous" },
  { id: "brouillon", label: "Brouillons" },
  { id: "en_attente", label: "En attente" },
  { id: "signe", label: "Signés" },
  { id: "archive", label: "Archivés" },
] as const;
type FilterId = (typeof FILTERS)[number]["id"];

function PvList() {
  const { activeCompanyId } = useCompany();
  const [items, setItems] = useState<Pv[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterId>("all");
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!activeCompanyId) return;
    setLoading(true);
    const { data } = await supabase
      .from("pv")
      .select("id,numero,type,status,reception_date,created_at,pdf_url")
      .eq("company_id", activeCompanyId)
      .order("created_at", { ascending: false });
    setItems((data as Pv[]) ?? []);
    setLoading(false);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [activeCompanyId]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length };
    for (const f of FILTERS) if (f.id !== "all") c[f.id] = 0;
    for (const p of items) c[p.status] = (c[p.status] ?? 0) + 1;
    return c;
  }, [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((p) => {
      if (filter !== "all" && p.status !== filter) return false;
      if (!q) return true;
      return (
        p.numero.toLowerCase().includes(q) ||
        (p.type ?? "").toLowerCase().includes(q)
      );
    });
  }, [items, filter, query]);

  async function remove(id: string) {
    if (!confirm("Supprimer ce PV ?")) return;
    const { error } = await supabase.from("pv").delete().eq("id", id);
    if (error) return toast.error(error.message);
    load();
  }
  async function download(path: string | null) {
    if (!path) return;
    const { data, error } = await supabase.storage.from("pv-assets").createSignedUrl(path, 60);
    if (error || !data) return toast.error("PDF indisponible");
    window.open(data.signedUrl, "_blank");
  }

  return (
    <div className="space-y-6">
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

      {/* Filters bar */}
      <Card className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <ListFilter className="h-4 w-4 text-muted-foreground" />
            {FILTERS.map((f) => {
              const active = filter === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition ${
                    active
                      ? "bg-primary text-primary-foreground shadow-brand"
                      : "border border-border bg-card text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {f.label}
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${
                    active ? "bg-primary-foreground/20" : "bg-muted text-foreground"
                  }`}>
                    {counts[f.id] ?? 0}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="relative w-full lg:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher par numéro ou type…"
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
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Numéro</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={5} className="py-16 text-center text-sm text-muted-foreground">
                  Chargement…
                </TableCell>
              </TableRow>
            )}
            {!loading && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-16 text-center">
                  <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary">
                    <FileText className="h-5 w-5" />
                  </div>
                  <p className="mt-3 text-sm font-medium">
                    {items.length === 0 ? "Aucun PV pour le moment" : "Aucun résultat"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {items.length === 0
                      ? "Démarrez en créant votre premier procès-verbal."
                      : "Ajustez vos filtres ou votre recherche."}
                  </p>
                  {items.length === 0 && (
                    <div className="mt-4">
                      <Link to="/pv/new">
                        <Button size="sm" className="shadow-brand">
                          <Plus className="h-3 w-3" /> Créer le premier PV
                        </Button>
                      </Link>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            )}
            {filtered.map((p) => (
              <TableRow key={p.id} className="group cursor-pointer hover:bg-muted/40">
                <TableCell className="font-medium">
                  <Link to="/pv/$id" params={{ id: p.id }} className="hover:underline">{p.numero}</Link>
                </TableCell>
                <TableCell className="text-muted-foreground">{p.type}</TableCell>
                <TableCell><PvStatusPill status={p.status} /></TableCell>
                <TableCell className="text-muted-foreground">
                  {p.reception_date ? new Date(p.reception_date).toLocaleDateString("fr-FR") : "—"}
                </TableCell>
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
                    <Button size="icon" variant="ghost" onClick={() => remove(p.id)} title="Supprimer">
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

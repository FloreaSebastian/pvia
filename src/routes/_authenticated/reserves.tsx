import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { AlertCircle, ExternalLink, Trash2, Filter } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { StatusPill } from "@/components/ui/status-pill";
import { PageHeader } from "@/components/app/PageHeader";
import { useCompany } from "@/hooks/use-company";

export const Route = createFileRoute("/_authenticated/reserves")({
  component: ReservesPage,
  head: () => ({ meta: [{ title: "Réserves — PVIA" }] }),
});

type Row = {
  id: string;
  description: string;
  severity: string;
  status: string;
  created_at: string;
  pv_id: string;
  nature: string | null;
  work_to_execute: string | null;
  due_date: string | null;
  pv: { numero: string } | null;
};

function ReservesPage() {
  const { activeCompanyId } = useCompany();
  const [items, setItems] = useState<Row[]>([]);
  const [filter, setFilter] = useState<string>("all");

  const load = useCallback(async () => {
    if (!activeCompanyId) return;
    const { data, error } = await supabase
      .from("pv_reserves")
      .select("id,description,severity,status,created_at,pv_id,nature,work_to_execute,due_date")
      .eq("company_id", activeCompanyId)
      .order("created_at", { ascending: false });
    if (error) return toast.error(error.message);
    const rows = (data ?? []) as Omit<Row, "pv">[];
    const pvIds = Array.from(new Set(rows.map((r) => r.pv_id)));
    const { data: pvs } = pvIds.length
      ? await supabase.from("pv").select("id,numero").in("id", pvIds)
      : { data: [] };
    const map = new Map((pvs ?? []).map((p) => [p.id, p.numero]));
    setItems(rows.map((r) => ({ ...r, pv: { numero: map.get(r.pv_id) ?? "—" } })));
  }, [activeCompanyId]);

  useEffect(() => { load(); }, [load]);

  async function setStatus(id: string, status: string) {
    const { error } = await supabase.from("pv_reserves").update({ status }).eq("id", id);
    if (error) return toast.error(error.message);
    setItems((rs) => rs.map((r) => (r.id === id ? { ...r, status } : r)));
    toast.success("Réserve mise à jour");
  }

  async function remove(id: string) {
    if (!confirm("Supprimer cette réserve ?")) return;
    const { error } = await supabase.from("pv_reserves").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setItems((rs) => rs.filter((r) => r.id !== id));
  }

  const filtered = items.filter((r) => filter === "all" || r.status === filter);
  const counts = {
    all: items.length,
    ouverte: items.filter((r) => r.status === "ouverte").length,
    levee: items.filter((r) => r.status === "levee").length,
    validee: items.filter((r) => r.status === "validee").length,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Réserves de chantier"
        description="Suivez et levez toutes les réserves liées à vos PV."
        contained={false}
        className="border-0 bg-transparent px-0 py-0"
        actions={
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes ({counts.all})</SelectItem>
                <SelectItem value="ouverte">Ouvertes ({counts.ouverte})</SelectItem>
                <SelectItem value="levee">Levées ({counts.levee})</SelectItem>
                <SelectItem value="validee">Validées ({counts.validee})</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { label: "Total", value: counts.all, tone: "neutral" as const },
          { label: "Ouvertes", value: counts.ouverte, tone: "destructive" as const },
          { label: "Levées", value: counts.levee, tone: "warning" as const },
          { label: "Validées", value: counts.validee, tone: "success" as const },
        ].map((s) => (
          <Card key={s.label} className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">{s.label}</p>
              <StatusPill tone={s.tone} size="sm" dot>{s.value}</StatusPill>
            </div>
            <p className="mt-1 font-display text-2xl font-bold">{s.value}</p>
          </Card>
        ))}
      </div>

      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>PV</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Sévérité</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead>Date</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-16 text-center text-sm text-muted-foreground">
                  <AlertCircle className="mx-auto mb-2 h-8 w-8 opacity-40" />
                  Aucune réserve.
                </TableCell>
              </TableRow>
            )}
            {filtered.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Link to="/pv/$id" params={{ id: r.pv_id }} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                    {r.pv?.numero} <ExternalLink className="h-3 w-3" />
                  </Link>
                </TableCell>
                <TableCell className="max-w-md">
                  {r.nature && <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{r.nature}</div>}
                  <div className="truncate">{r.description}</div>
                  {r.work_to_execute && <div className="mt-0.5 truncate text-xs text-muted-foreground"><span className="font-medium">Travaux :</span> {r.work_to_execute}</div>}
                  {r.due_date && <div className="mt-0.5 text-xs text-warning">Échéance : {new Date(r.due_date).toLocaleDateString("fr-FR")}</div>}
                </TableCell>
                <TableCell><StatusPill tone={r.severity === "majeure" ? "destructive" : "neutral"}>{r.severity}</StatusPill></TableCell>
                <TableCell>
                  <Select value={r.status} onValueChange={(v) => setStatus(r.id, v)}>
                    <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ouverte">Ouverte</SelectItem>
                      <SelectItem value="levee">Levée</SelectItem>
                      <SelectItem value="validee">Validée</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="text-muted-foreground">{new Date(r.created_at).toLocaleDateString("fr-FR")}</TableCell>
                <TableCell className="text-right">
                  <Button size="icon" variant="ghost" onClick={() => remove(r.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

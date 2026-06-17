import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { AlertCircle, ExternalLink, Trash2, Filter, CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { StatusPill } from "@/components/ui/status-pill";
import { PageHeader } from "@/components/app/PageHeader";
import { useCompany } from "@/hooks/use-company";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";

const reservesSearchSchema = z.object({
  status: fallback(z.enum(["all", "ouverte", "levee", "validee"]), "all").default("all"),
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
  created_at: string;
  pv_id: string;
  nature: string | null;
  work_to_execute: string | null;
  due_date: string | null;
  lifted_at: string | null;
  validated_at: string | null;
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
      .select("id,description,severity,status,created_at,pv_id,nature,work_to_execute,due_date,lifted_at,validated_at")
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
    <div className="space-y-4">
      <PageHeader
        title="Réserves de chantier"
        description={items.length > 0 ? `${counts.ouverte} ouverte(s) · ${counts.levee} levée(s) · ${counts.validee} validée(s)` : undefined}
        contained={false}
        className="border-0 bg-transparent px-0 py-0"
        actions={
          items.length > 0 ? (
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Select value={filter} onValueChange={setFilter}>
                <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes ({counts.all})</SelectItem>
                  <SelectItem value="ouverte">Ouvertes ({counts.ouverte})</SelectItem>
                  <SelectItem value="levee">Levées ({counts.levee})</SelectItem>
                  <SelectItem value="validee">Validées ({counts.validee})</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null
        }
      />

      {filtered.length === 0 ? (
        items.length === 0 ? (
          <Card className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
            <AlertCircle className="h-7 w-7 opacity-40" />
            <p>Aucune réserve enregistrée pour l'instant.</p>
            <p className="text-xs">Les réserves créées depuis vos PV apparaîtront ici.</p>
          </Card>
        ) : (
          <p className="px-1 text-xs text-muted-foreground">Aucun résultat pour ce filtre.</p>
        )
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((r) => {
            const statusLabel = r.status === "ouverte" ? "Ouverte" : r.status === "levee" ? "Levée" : "Validée";
            const statusTone = r.status === "ouverte" ? "destructive" : r.status === "validee" ? "success" : "warning";
            return (
              <Card key={r.id} className="flex flex-col gap-2 p-3">
                <div className="flex items-center justify-between gap-2">
                  <Link to="/pv/$id" params={{ id: r.pv_id }} className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                    PV {r.pv?.numero} <ExternalLink className="h-3 w-3" />
                  </Link>
                  <div className="flex items-center gap-1">
                    <StatusPill tone={r.severity === "majeure" ? "destructive" : "neutral"} size="sm">{r.severity}</StatusPill>
                    <StatusPill tone={statusTone as any} size="sm" dot>{statusLabel}</StatusPill>
                  </div>
                </div>
                {r.nature && <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{r.nature}</div>}
                <p className="line-clamp-2 text-sm leading-snug">{r.description}</p>
                {r.work_to_execute && (
                  <p className="line-clamp-1 text-xs text-muted-foreground"><span className="font-medium">Travaux :</span> {r.work_to_execute}</p>
                )}
                {r.due_date && <p className="text-xs text-warning">Échéance : {new Date(r.due_date).toLocaleDateString("fr-FR")}</p>}
                <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                  <Select value={r.status} onValueChange={(v) => setStatus(r.id, v)}>
                    <SelectTrigger className="h-8 flex-1 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ouverte">Ouverte</SelectItem>
                      <SelectItem value="levee">Levée</SelectItem>
                      <SelectItem value="validee">Validée client</SelectItem>
                    </SelectContent>
                  </Select>
                  {r.status === "ouverte" && (
                    <Link to="/pv/$id/levee-reserves" params={{ id: r.pv_id }} search={{ reserveId: r.id }}>
                      <Button size="sm" variant="outline" className="h-8">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Lever
                      </Button>
                    </Link>
                  )}
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => remove(r.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Database, Download, FileSpreadsheet, FileText, Users, Building2, Trash2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/hooks/use-company";

export const Route = createFileRoute("/_authenticated/parametres/donnees")({
  component: DataExports,
  head: () => ({ meta: [{ title: "Données & exports — Paramètres PVIA" }] }),
});

function toCsv(rows: Record<string, any>[]) {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v: any) => {
    if (v == null) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

function download(name: string, content: string, mime = "text/csv") {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

function DataExports() {
  const { activeCompanyId, can } = useCompany();
  const [busy, setBusy] = useState<string | null>(null);

  async function exportTable(table: "pv" | "clients" | "chantiers" | "audit_logs", filename: string) {
    if (!activeCompanyId) return;
    setBusy(filename);
    try {
      const { data, error } = await supabase.from(table).select("*").eq("company_id", activeCompanyId).limit(10000);
      if (error) throw new Error(error.message);
      download(`${filename}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(data ?? []));
      toast.success(`Export ${filename} terminé (${data?.length ?? 0} lignes).`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(null); }
  }

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="mb-4 flex items-center gap-2">
          <Database className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">Exports CSV</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <ExportRow icon={<FileText className="h-4 w-4" />} title="Procès-verbaux" desc="Tous les PV de l'entreprise."
            busy={busy === "pv"} onClick={() => exportTable("pv", "pv")} />
          <ExportRow icon={<Users className="h-4 w-4" />} title="Clients" desc="Carnet d'adresses clients."
            busy={busy === "clients"} onClick={() => exportTable("clients", "clients")} />
          <ExportRow icon={<Building2 className="h-4 w-4" />} title="Chantiers" desc="Liste complète des chantiers."
            busy={busy === "chantiers"} onClick={() => exportTable("chantiers", "chantiers")} />
          <ExportRow icon={<FileSpreadsheet className="h-4 w-4" />} title="Journal d'audit" desc="Traçabilité conformité."
            busy={busy === "audit"} onClick={() => exportTable("audit_logs", "audit")} />
        </div>
      </Card>

      <Card className="p-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold">Export RGPD</h2>
          <Badge variant="secondary">Bientôt</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Archive complète de vos données personnelles et professionnelles dans un format portable (JSON + PDF).
        </p>
        <Button variant="outline" size="sm" className="mt-4" disabled>
          <Download className="mr-2 h-4 w-4" /> Demander mon export
        </Button>
      </Card>

      <Card className="border-destructive/40 p-6">
        <div className="mb-2 flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-4 w-4" />
          <h2 className="font-semibold">Zone dangereuse</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          La suppression définitive du compte entreprise (PV, audit, factures) est irréversible et soumise à validation.
          Contactez le support pour engager cette procédure.
        </p>
        <Button variant="destructive" size="sm" className="mt-4" disabled={!can("owner")}>
          <Trash2 className="mr-2 h-4 w-4" /> Supprimer l'entreprise
        </Button>
      </Card>
    </div>
  );
}

function ExportRow({ icon, title, desc, busy, onClick }: { icon: React.ReactNode; title: string; desc: string; busy: boolean; onClick: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card/40 p-4">
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary">{icon}</div>
        <div>
          <div className="text-sm font-medium">{title}</div>
          <div className="text-xs text-muted-foreground">{desc}</div>
        </div>
      </div>
      <Button size="sm" variant="outline" onClick={onClick} disabled={busy}>
        <Download className="mr-2 h-4 w-4" />
        {busy ? "…" : "CSV"}
      </Button>
    </div>
  );
}

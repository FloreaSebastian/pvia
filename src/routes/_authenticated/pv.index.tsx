import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Download, Trash2, FileText } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useCompany } from "@/hooks/use-company";

export const Route = createFileRoute("/_authenticated/pv/")({
  component: PvList,
  head: () => ({ meta: [{ title: "Procès-verbaux — PVIA" }] }),
});

type Pv = { id: string; numero: string; type: string; status: string; reception_date: string | null; created_at: string; pdf_url: string | null };

function PvList() {
  const { activeCompanyId } = useCompany();
  const [items, setItems] = useState<Pv[]>([]);
  async function load() {
    if (!activeCompanyId) return;
    const { data } = await supabase
      .from("pv")
      .select("id,numero,type,status,reception_date,created_at,pdf_url")
      .eq("company_id", activeCompanyId)
      .order("created_at", { ascending: false });
    setItems((data as Pv[]) ?? []);
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activeCompanyId]);
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
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Procès-verbaux</h1>
          <p className="text-sm text-muted-foreground">Tous vos PV de réception.</p>
        </div>
        <Link to="/pv/new"><Button><Plus className="h-4 w-4" /> Nouveau PV</Button></Link>
      </div>
      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader><TableRow><TableHead>Numéro</TableHead><TableHead>Type</TableHead><TableHead>Statut</TableHead><TableHead>Date</TableHead><TableHead></TableHead></TableRow></TableHeader>
          <TableBody>
            {items.length === 0 && <TableRow><TableCell colSpan={5} className="py-16 text-center text-sm text-muted-foreground"><FileText className="mx-auto mb-2 h-8 w-8 opacity-50" />Aucun PV. Créez le premier !</TableCell></TableRow>}
            {items.map((p) => (
              <TableRow key={p.id} className="cursor-pointer hover:bg-muted/40">
                <TableCell className="font-medium">
                  <Link to="/pv/$id" params={{ id: p.id }} className="hover:underline">{p.numero}</Link>
                </TableCell>
                <TableCell>{p.type}</TableCell>
                <TableCell><Badge variant={p.status === "signe" ? "default" : "secondary"}>{p.status}</Badge></TableCell>
                <TableCell>{p.reception_date ? new Date(p.reception_date).toLocaleDateString("fr-FR") : "—"}</TableCell>
                <TableCell className="text-right">
                  <Link to="/pv/$id" params={{ id: p.id }}>
                    <Button size="sm" variant="ghost">Ouvrir</Button>
                  </Link>
                  {p.pdf_url && <Button size="icon" variant="ghost" onClick={() => download(p.pdf_url)}><Download className="h-4 w-4" /></Button>}
                  <Button size="icon" variant="ghost" onClick={() => remove(p.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

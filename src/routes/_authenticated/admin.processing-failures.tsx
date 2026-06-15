import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  listProcessingFailures,
  retryPvPdfGeneration,
  retryReserveLiftPdfGeneration,
} from "@/lib/processing-retry.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/app/PageHeader";
import { Loader2, RefreshCw, ExternalLink, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/processing-failures")({
  component: Page,
  head: () => ({ meta: [{ title: "PV en erreur — PVIA" }] }),
  beforeLoad: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw redirect({ to: "/login" });
    const { isPlatformAdminEmail } = await import("@/lib/platform-admin");
    if (!isPlatformAdminEmail(user.email)) throw redirect({ to: "/admin/forbidden" });
    const { data } = await supabase
      .from("user_roles").select("role")
      .eq("user_id", user.id).eq("role", "platform_admin").maybeSingle();
    if (!data) throw redirect({ to: "/admin/forbidden" });
  },
});

type PvRow = {
  id: string; numero: string; company_id: string; status: string;
  processing_status: string; pdf_generation_status: string;
  photos_failed_count: number; processing_errors: Array<{ step: string; message: string; at: string }>;
  created_at: string;
};
type LiftRow = {
  id: string; numero: string; company_id: string; pv_id: string; status: string;
  processing_status: string; pdf_generation_status: string;
  processing_errors: Array<{ step: string; message: string; at: string }>;
  created_at: string;
};

function Page() {
  const list = useServerFn(listProcessingFailures);
  const retryPv = useServerFn(retryPvPdfGeneration);
  const retryLift = useServerFn(retryReserveLiftPdfGeneration);
  const [pvs, setPvs] = useState<PvRow[]>([]);
  const [lifts, setLifts] = useState<LiftRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await list();
      setPvs((res.pvs ?? []) as PvRow[]);
      setLifts((res.lifts ?? []) as LiftRow[]);
    } catch (e: any) {
      toast.error(e?.message ?? "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }, [list]);

  useEffect(() => { void load(); }, [load]);

  async function handleRetryPv(pvId: string) {
    setRetrying(pvId);
    try {
      await retryPv({ data: { pvId } });
      toast.success("PDF régénéré");
      await load();
    } catch (e: any) { toast.error(e?.message ?? "Échec"); }
    finally { setRetrying(null); }
  }
  async function handleRetryLift(id: string) {
    setRetrying(id);
    try {
      await retryLift({ data: { reportId: id } });
      toast.success("PDF levée régénéré");
      await load();
    } catch (e: any) { toast.error(e?.message ?? "Échec"); }
    finally { setRetrying(null); }
  }

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
      <PageHeader
        title="PV / levées en erreur partielle"
        description="Inserts, uploads, PDF ou emails qui ont échoué pendant la création. Retry manuel disponible."
      />
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Recharger
        </Button>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600" /> PV ({pvs.length})
        </h2>
        {pvs.length === 0 && !loading ? (
          <Card className="p-6 text-sm text-muted-foreground">Aucun PV en erreur.</Card>
        ) : pvs.map((pv) => (
          <Card key={pv.id} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{pv.numero}</span>
                  <Badge variant={pv.processing_status === "failed" ? "destructive" : "secondary"}>
                    {pv.processing_status}
                  </Badge>
                  <Badge variant="outline">PDF: {pv.pdf_generation_status}</Badge>
                  {pv.photos_failed_count > 0 && (
                    <Badge variant="outline">{pv.photos_failed_count} photo(s) KO</Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {new Date(pv.created_at).toLocaleString("fr-FR")} · company {pv.company_id.slice(0, 8)}…
                </div>
                <ul className="mt-2 space-y-0.5 text-xs font-mono">
                  {(pv.processing_errors ?? []).slice(0, 4).map((e, i) => (
                    <li key={i}>· {e.step} — {e.message}</li>
                  ))}
                </ul>
              </div>
              <div className="flex gap-2">
                {pv.pdf_generation_status === "failed" && pv.status === "signe" && (
                  <Button size="sm" variant="outline" onClick={() => handleRetryPv(pv.id)} disabled={retrying === pv.id}>
                    {retrying === pv.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                    Régénérer PDF
                  </Button>
                )}
                <Link to="/pv/$id" params={{ id: pv.id }}>
                  <Button size="sm" variant="ghost"><ExternalLink className="h-3 w-3" /> Ouvrir</Button>
                </Link>
              </div>
            </div>
          </Card>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600" /> Levées de réserves ({lifts.length})
        </h2>
        {lifts.length === 0 && !loading ? (
          <Card className="p-6 text-sm text-muted-foreground">Aucune levée en erreur.</Card>
        ) : lifts.map((l) => (
          <Card key={l.id} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{l.numero}</span>
                  <Badge variant={l.processing_status === "failed" ? "destructive" : "secondary"}>
                    {l.processing_status}
                  </Badge>
                  <Badge variant="outline">PDF: {l.pdf_generation_status}</Badge>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {new Date(l.created_at).toLocaleString("fr-FR")}
                </div>
                <ul className="mt-2 space-y-0.5 text-xs font-mono">
                  {(l.processing_errors ?? []).slice(0, 4).map((e, i) => (
                    <li key={i}>· {e.step} — {e.message}</li>
                  ))}
                </ul>
              </div>
              <div className="flex gap-2">
                {l.pdf_generation_status === "failed" && (
                  <Button size="sm" variant="outline" onClick={() => handleRetryLift(l.id)} disabled={retrying === l.id}>
                    {retrying === l.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                    Régénérer PDF
                  </Button>
                )}
                <Link to="/pv/$id" params={{ id: l.pv_id }}>
                  <Button size="sm" variant="ghost"><ExternalLink className="h-3 w-3" /> PV</Button>
                </Link>
              </div>
            </div>
          </Card>
        ))}
      </section>
    </div>
  );
}

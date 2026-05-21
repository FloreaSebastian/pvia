import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import {
  ArrowLeft, ShieldCheck, FileText, Mail, Send, Camera, AlertCircle,
  PenSquare, Plus, Edit, Trash2, UserPlus, CheckCircle2, Download, Loader2, Filter,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useServerFn } from "@tanstack/react-start";
import { listPvAuditLogs, exportPvAuditPdf } from "@/lib/audit.functions";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/pv/$id/historique")({
  component: HistoriquePage,
  head: () => ({ meta: [{ title: "Historique légal — PVIA" }] }),
});

type Log = {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  user_id: string | null;
  user_name: string | null;
  created_at: string;
  ip_address: string | null;
  old_values: any;
  new_values: any;
  metadata: any;
};

const ACTION_META: Record<string, { label: string; icon: any; badge: string; tone: string }> = {
  "pv.create": { label: "PV créé", icon: Plus, badge: "Système", tone: "bg-success/15 text-success" },
  "pv.update": { label: "PV modifié", icon: Edit, badge: "Utilisateur", tone: "bg-primary/15 text-primary" },
  "pv.updated": { label: "PV modifié", icon: Edit, badge: "Utilisateur", tone: "bg-primary/15 text-primary" },
  "pv.delete": { label: "PV supprimé", icon: Trash2, badge: "Utilisateur", tone: "bg-destructive/15 text-destructive" },
  "pv.status_change": { label: "Changement de statut", icon: ShieldCheck, badge: "Système", tone: "bg-muted text-muted-foreground" },
  "pv.sent_to_client": { label: "Envoyé au client", icon: Send, badge: "Email", tone: "bg-accent/30 text-accent-foreground" },
  "pv.signed_by_client": { label: "Signé par le client", icon: PenSquare, badge: "Client", tone: "bg-success/15 text-success" },
  "pv.signed_by_company": { label: "Signé par l'entreprise", icon: PenSquare, badge: "Signature", tone: "bg-success/15 text-success" },
  "pv.pdf_generated": { label: "PDF généré", icon: FileText, badge: "PDF", tone: "bg-accent/30 text-accent-foreground" },
  "pv.pdf_downloaded": { label: "PDF téléchargé", icon: Download, badge: "PDF", tone: "bg-accent/30 text-accent-foreground" },
  "pv.email_sent": { label: "Email envoyé", icon: Mail, badge: "Email", tone: "bg-accent/30 text-accent-foreground" },
  "pv.email_failed": { label: "Échec d'envoi email", icon: AlertCircle, badge: "Email", tone: "bg-destructive/15 text-destructive" },
  "reserve.create": { label: "Réserve créée", icon: AlertCircle, badge: "Utilisateur", tone: "bg-warning/15 text-warning" },
  "reserve.update": { label: "Réserve modifiée", icon: Edit, badge: "Utilisateur", tone: "bg-primary/15 text-primary" },
  "reserve.delete": { label: "Réserve supprimée", icon: Trash2, badge: "Utilisateur", tone: "bg-destructive/15 text-destructive" },
  "reserve.lifted": { label: "Réserve levée", icon: CheckCircle2, badge: "Utilisateur", tone: "bg-success/15 text-success" },
  "reserve.validated": { label: "Réserve validée", icon: CheckCircle2, badge: "Utilisateur", tone: "bg-success/15 text-success" },
  "photo.add": { label: "Photo ajoutée", icon: Camera, badge: "Utilisateur", tone: "bg-primary/15 text-primary" },
  "photo.delete": { label: "Photo supprimée", icon: Trash2, badge: "Utilisateur", tone: "bg-destructive/15 text-destructive" },
  "member.invited": { label: "Membre invité", icon: UserPlus, badge: "Équipe", tone: "bg-primary/15 text-primary" },
  "member.joined": { label: "Membre rejoint", icon: UserPlus, badge: "Équipe", tone: "bg-success/15 text-success" },
  "member.role_changed": { label: "Rôle modifié", icon: Edit, badge: "Équipe", tone: "bg-primary/15 text-primary" },
  "member.suspended": { label: "Membre suspendu", icon: AlertCircle, badge: "Équipe", tone: "bg-warning/15 text-warning" },
  "member.reactivated": { label: "Membre réactivé", icon: CheckCircle2, badge: "Équipe", tone: "bg-success/15 text-success" },
  "member.removed": { label: "Membre retiré", icon: Trash2, badge: "Équipe", tone: "bg-destructive/15 text-destructive" },
  "audit.exported": { label: "Historique exporté", icon: Download, badge: "Audit", tone: "bg-muted text-muted-foreground" },
};

function metaFor(action: string) {
  return ACTION_META[action] || { label: action, icon: ShieldCheck, badge: "Système", tone: "bg-slate-100 text-slate-800" };
}

const PAGE_SIZE = 50;

function HistoriquePage() {
  const { id } = Route.useParams();
  const fetchLogs = useServerFn(listPvAuditLogs);
  const exportFn = useServerFn(exportPvAuditPdf);
  const [logs, setLogs] = useState<Log[]>([]);
  const [pvNumero, setPvNumero] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [canSeeDetails, setCanSeeDetails] = useState(false);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const [exporting, setExporting] = useState(false);

  // Server-side filter mapping (prefix → list of actions OR we filter client-side by prefix via metadata.action.startsWith).
  // We keep server pagination total accurate by sending an `actions` array when a filter is active.
  const actionsForFilter = (f: string): string[] | undefined => {
    if (f === "all") return undefined;
    // We don't enumerate all actions to keep this generic — use server filter only when known set.
    return undefined;
  };

  const reload = async () => {
    setLoading(true);
    try {
      const [{ data: pv }, res] = await Promise.all([
        supabase.from("pv").select("numero").eq("id", id).maybeSingle(),
        fetchLogs({ data: { pvId: id, limit: PAGE_SIZE, offset: 0, actions: actionsForFilter(filter) } }),
      ]);
      if (pv) setPvNumero(pv.numero);
      setLogs(res.logs as Log[]);
      setCanSeeDetails(res.canSeeDetails);
      setTotal(res.total);
      setHasMore(res.hasMore);
    } catch (e: any) {
      toast.error(e?.message ?? "Erreur chargement");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, filter]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const res = await fetchLogs({ data: { pvId: id, limit: PAGE_SIZE, offset: logs.length, actions: actionsForFilter(filter) } });
      setLogs((prev) => [...prev, ...(res.logs as Log[])]);
      setHasMore(res.hasMore);
      setTotal(res.total);
    } catch (e: any) {
      toast.error(e?.message ?? "Erreur");
    } finally {
      setLoadingMore(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const { url } = await exportFn({ data: { pvId: id } });
      if (url) window.open(url, "_blank");
      else toast.error("URL indisponible");
    } catch (e: any) {
      toast.error(e?.message ?? "Erreur export");
    } finally {
      setExporting(false);
    }
  };

  const filtered = useMemo(() => {
    if (filter === "all") return logs;
    return logs.filter((l: Log) => l.action.startsWith(filter));
  }, [logs, filter]);

  return (
    <div className="container max-w-4xl py-8 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link to="/pv/$id" params={{ id }}>
            <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4" /> Retour au PV</Button>
          </Link>
          <h1 className="text-2xl font-semibold mt-2 flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-emerald-600" /> Historique légal
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            PV <span className="font-mono">{pvNumero}</span> · {total} événement(s) tracé(s) · {logs.length} chargé(s)
          </p>
          <Badge variant="secondary" className="mt-2 gap-1.5 bg-emerald-100 text-emerald-800">
            <ShieldCheck className="h-3 w-3" /> Traçabilité complète
          </Badge>
        </div>
        <div className="flex gap-2">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les événements</SelectItem>
                <SelectItem value="pv.">PV</SelectItem>
                <SelectItem value="reserve.">Réserves</SelectItem>
                <SelectItem value="photo.">Photos</SelectItem>
                <SelectItem value="member.">Équipe</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleExport} disabled={exporting}>
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Exporter PDF
          </Button>
        </div>
      </div>

      {loading ? (
        <Card className="p-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></Card>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center text-sm text-muted-foreground">Aucun événement.</Card>
      ) : (
        <div className="space-y-4">
        <div className="relative pl-8 space-y-4 before:absolute before:left-3 before:top-2 before:bottom-2 before:w-px before:bg-border">
          {filtered.map((l) => {
            const m = metaFor(l.action);
            const Icon = m.icon;
            return (
              <Card key={l.id} className="p-4 relative">
                <div className="absolute -left-[28px] top-4 h-6 w-6 rounded-full bg-background border-2 border-border flex items-center justify-center">
                  <Icon className="h-3 w-3" />
                </div>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-medium flex items-center gap-2">
                      {m.label}
                      <Badge variant="secondary" className={m.tone + " text-[10px]"}>{m.badge}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {new Date(l.created_at).toLocaleString("fr-FR")}
                      {l.user_name && <span> · par <span className="font-medium text-foreground">{l.user_name}</span></span>}
                      {!l.user_name && l.user_id && <span> · par utilisateur</span>}
                      {!l.user_name && !l.user_id && <span> · automatique</span>}
                      {canSeeDetails && l.ip_address && <span className="font-mono"> · {l.ip_address}</span>}
                    </div>
                  </div>
                </div>
                {l.metadata && Object.keys(l.metadata).length > 0 && (
                  <div className="mt-2 text-xs text-muted-foreground bg-muted/40 rounded p-2 font-mono overflow-x-auto">
                    {JSON.stringify(l.metadata)}
                  </div>
                )}
                {canSeeDetails && (l.old_values || l.new_values) && (
                  <div className="mt-2 grid sm:grid-cols-2 gap-2 text-xs">
                    {l.old_values && (
                      <div className="bg-red-50 border border-red-200 rounded p-2">
                        <div className="font-semibold text-red-900 mb-1">Avant</div>
                        <pre className="font-mono whitespace-pre-wrap break-words text-red-800">{JSON.stringify(l.old_values, null, 2)}</pre>
                      </div>
                    )}
                    {l.new_values && (
                      <div className="bg-emerald-50 border border-emerald-200 rounded p-2">
                        <div className="font-semibold text-emerald-900 mb-1">Après</div>
                        <pre className="font-mono whitespace-pre-wrap break-words text-emerald-800">{JSON.stringify(l.new_values, null, 2)}</pre>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
          </div>
          {hasMore && (
            <div className="flex justify-center pt-2">
              <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Charger plus ({logs.length} / {total})
              </Button>
            </div>
          )}
        </div>
      )}

      {!canSeeDetails && (
        <p className="text-xs text-muted-foreground text-center">
          Les valeurs détaillées (avant/après, IP) sont réservées aux administrateurs.
        </p>
      )}
    </div>
  );
}

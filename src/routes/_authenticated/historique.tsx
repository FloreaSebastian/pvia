import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ShieldCheck, FileText, Mail, Send, Camera, AlertCircle, PenSquare, Plus, Edit,
  Trash2, UserPlus, CheckCircle2, Download, Loader2, Filter, Search,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useServerFn } from "@tanstack/react-start";
import { listCompanyAuditLogs, exportCompanyAuditPdf } from "@/lib/audit.functions";
import { useCompany } from "@/hooks/use-company";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/historique")({
  component: HistoriqueEntreprisePage,
  head: () => ({ meta: [{ title: "Historique entreprise — PVIA" }] }),
});

type Log = {
  id: string; action: string; entity_type: string; entity_id: string | null;
  pv_id: string | null; pv_numero: string | null; user_id: string | null;
  user_name: string | null; created_at: string; ip_address: string | null;
  old_values: any; new_values: any; metadata: any;
};

const ACTION_META: Record<string, { label: string; icon: any; badge: string; tone: string }> = {
  "pv.create": { label: "PV créé", icon: Plus, badge: "Système", tone: "bg-emerald-100 text-emerald-800" },
  "pv.update": { label: "PV modifié", icon: Edit, badge: "Utilisateur", tone: "bg-blue-100 text-blue-800" },
  "pv.updated": { label: "PV modifié", icon: Edit, badge: "Utilisateur", tone: "bg-blue-100 text-blue-800" },
  "pv.delete": { label: "PV supprimé", icon: Trash2, badge: "Utilisateur", tone: "bg-red-100 text-red-800" },
  "pv.status_change": { label: "Changement de statut", icon: ShieldCheck, badge: "Système", tone: "bg-slate-100 text-slate-800" },
  "pv.sent_to_client": { label: "Envoyé au client", icon: Send, badge: "Email", tone: "bg-indigo-100 text-indigo-800" },
  "pv.signed_by_client": { label: "Signé par le client", icon: PenSquare, badge: "Client", tone: "bg-emerald-100 text-emerald-800" },
  "pv.signed_by_company": { label: "Signé par l'entreprise", icon: PenSquare, badge: "Signature", tone: "bg-emerald-100 text-emerald-800" },
  "pv.pdf_generated": { label: "PDF généré", icon: FileText, badge: "PDF", tone: "bg-purple-100 text-purple-800" },
  "pv.pdf_downloaded": { label: "PDF téléchargé", icon: Download, badge: "PDF", tone: "bg-purple-100 text-purple-800" },
  "pv.email_sent": { label: "Email envoyé", icon: Mail, badge: "Email", tone: "bg-indigo-100 text-indigo-800" },
  "pv.email_failed": { label: "Échec email", icon: AlertCircle, badge: "Email", tone: "bg-red-100 text-red-800" },
  "reserve.create": { label: "Réserve créée", icon: AlertCircle, badge: "Utilisateur", tone: "bg-amber-100 text-amber-800" },
  "reserve.update": { label: "Réserve modifiée", icon: Edit, badge: "Utilisateur", tone: "bg-blue-100 text-blue-800" },
  "reserve.delete": { label: "Réserve supprimée", icon: Trash2, badge: "Utilisateur", tone: "bg-red-100 text-red-800" },
  "reserve.lifted": { label: "Réserve levée", icon: CheckCircle2, badge: "Utilisateur", tone: "bg-emerald-100 text-emerald-800" },
  "reserve.validated": { label: "Réserve validée", icon: CheckCircle2, badge: "Utilisateur", tone: "bg-emerald-100 text-emerald-800" },
  "photo.add": { label: "Photo ajoutée", icon: Camera, badge: "Utilisateur", tone: "bg-blue-100 text-blue-800" },
  "photo.delete": { label: "Photo supprimée", icon: Trash2, badge: "Utilisateur", tone: "bg-red-100 text-red-800" },
  "member.invited": { label: "Membre invité", icon: UserPlus, badge: "Équipe", tone: "bg-blue-100 text-blue-800" },
  "member.joined": { label: "Membre rejoint", icon: UserPlus, badge: "Équipe", tone: "bg-emerald-100 text-emerald-800" },
  "member.role_changed": { label: "Rôle modifié", icon: Edit, badge: "Équipe", tone: "bg-blue-100 text-blue-800" },
  "member.suspended": { label: "Membre suspendu", icon: AlertCircle, badge: "Équipe", tone: "bg-amber-100 text-amber-800" },
  "member.reactivated": { label: "Membre réactivé", icon: CheckCircle2, badge: "Équipe", tone: "bg-emerald-100 text-emerald-800" },
  "member.removed": { label: "Membre retiré", icon: Trash2, badge: "Équipe", tone: "bg-red-100 text-red-800" },
  "audit.exported": { label: "Historique exporté", icon: Download, badge: "Audit", tone: "bg-slate-100 text-slate-800" },
};

function metaFor(a: string) {
  return ACTION_META[a] || { label: a, icon: ShieldCheck, badge: "Système", tone: "bg-slate-100 text-slate-800" };
}

const PAGE_SIZE = 50;

function HistoriqueEntreprisePage() {
  const { activeCompanyId, activeRole } = useCompany();
  const fetchLogs = useServerFn(listCompanyAuditLogs);
  const exportFn = useServerFn(exportCompanyAuditPdf);

  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [canSeeDetails, setCanSeeDetails] = useState(false);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [category, setCategory] = useState<string>("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  const canExport = activeRole === "owner" || activeRole === "admin";

  const reload = async () => {
    if (!activeCompanyId) return;
    setLoading(true);
    try {
      const res = await fetchLogs({
        data: { companyId: activeCompanyId, category, search: search || undefined, limit: PAGE_SIZE, offset: 0 },
      });
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
  }, [activeCompanyId, category, search]);

  const loadMore = async () => {
    if (!activeCompanyId) return;
    setLoadingMore(true);
    try {
      const res = await fetchLogs({
        data: { companyId: activeCompanyId, category, search: search || undefined, limit: PAGE_SIZE, offset: logs.length },
      });
      setLogs((p) => [...p, ...(res.logs as Log[])]);
      setHasMore(res.hasMore);
      setTotal(res.total);
    } catch (e: any) {
      toast.error(e?.message ?? "Erreur");
    } finally {
      setLoadingMore(false);
    }
  };

  const handleExport = async () => {
    if (!activeCompanyId) return;
    setExporting(true);
    try {
      const { url } = await exportFn({ data: { companyId: activeCompanyId, category, search: search || undefined } });
      if (url) window.open(url, "_blank");
      else toast.error("URL indisponible");
    } catch (e: any) {
      toast.error(e?.message ?? "Erreur export");
    } finally {
      setExporting(false);
    }
  };

  const filtered = useMemo(() => {
    const s = searchInput.trim().toLowerCase();
    if (!s) return logs;
    return logs.filter(
      (l) =>
        l.action.toLowerCase().includes(s) ||
        (l.user_name || "").toLowerCase().includes(s) ||
        (l.pv_numero || "").toLowerCase().includes(s) ||
        (l.entity_type || "").toLowerCase().includes(s),
    );
  }, [logs, searchInput]);

  return (
    <div className="container max-w-5xl py-8 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-emerald-600" /> Historique entreprise
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {total} événement(s) tracé(s) · {logs.length} chargé(s)
          </p>
          <Badge variant="secondary" className="mt-2 gap-1.5 bg-emerald-100 text-emerald-800">
            <ShieldCheck className="h-3 w-3" /> Traçabilité complète activée
          </Badge>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleExport} disabled={exporting || !canExport} title={!canExport ? "Réservé aux owner/admin" : undefined}>
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Exporter l'historique entreprise
          </Button>
        </div>
      </div>

      <Card className="p-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes catégories</SelectItem>
              <SelectItem value="pv">PV</SelectItem>
              <SelectItem value="reserve">Réserves</SelectItem>
              <SelectItem value="photo">Photos</SelectItem>
              <SelectItem value="member">Équipe</SelectItem>
              <SelectItem value="audit">Audit / Exports</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2 flex-1 min-w-[240px]">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setSearch(searchInput);
            }}
            onBlur={() => setSearch(searchInput)}
            placeholder="Rechercher action, utilisateur, PV…"
          />
        </div>
      </Card>

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
                        {l.pv_numero && l.pv_id && (
                          <Link to="/pv/$id" params={{ id: l.pv_id }}>
                            <Badge variant="outline" className="text-[10px] font-mono hover:bg-accent cursor-pointer">
                              {l.pv_numero}
                            </Badge>
                          </Link>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {new Date(l.created_at).toLocaleString("fr-FR")}
                        {l.user_name && <span> · par <span className="font-medium text-foreground">{l.user_name}</span></span>}
                        {!l.user_name && l.user_id && <span> · par utilisateur</span>}
                        {!l.user_name && !l.user_id && <span> · automatique</span>}
                        {canSeeDetails && l.ip_address && <span className="font-mono"> · {l.ip_address}</span>}
                      </div>
                    </div>
                    {l.pv_id && (
                      <Link to="/pv/$id/historique" params={{ id: l.pv_id }}>
                        <Button variant="ghost" size="sm">Voir le PV</Button>
                      </Link>
                    )}
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

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
import { PageHeader } from "@/components/app/PageHeader";

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
  "pv.create": { label: "PV créé", icon: Plus, badge: "Système", tone: "bg-success/15 text-success" },
  "pv.update": { label: "PV modifié", icon: Edit, badge: "Utilisateur", tone: "bg-primary/15 text-primary" },
  "pv.updated": { label: "PV modifié", icon: Edit, badge: "Utilisateur", tone: "bg-primary/15 text-primary" },
  "pv.delete": { label: "PV supprimé", icon: Trash2, badge: "Utilisateur", tone: "bg-destructive/15 text-destructive" },
  "pv.status_change": { label: "Changement de statut", icon: ShieldCheck, badge: "Système", tone: "bg-muted text-muted-foreground" },
  "pv.sent_to_client": { label: "Envoyé au client", icon: Send, badge: "Email", tone: "bg-primary/15 text-primary" },
  "pv.signed_by_client": { label: "Signé par le client", icon: PenSquare, badge: "Client", tone: "bg-success/15 text-success" },
  "pv.signed_by_company": { label: "Signé par l'entreprise", icon: PenSquare, badge: "Signature", tone: "bg-success/15 text-success" },
  "pv.pdf_generated": { label: "PDF généré", icon: FileText, badge: "PDF", tone: "bg-accent/30 text-accent-foreground" },
  "pv.pdf_downloaded": { label: "PDF téléchargé", icon: Download, badge: "PDF", tone: "bg-accent/30 text-accent-foreground" },
  "pv.email_sent": { label: "Email envoyé", icon: Mail, badge: "Email", tone: "bg-primary/15 text-primary" },
  "pv.email_failed": { label: "Échec email", icon: AlertCircle, badge: "Email", tone: "bg-destructive/15 text-destructive" },
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

function metaFor(a: string) {
  return ACTION_META[a] || { label: a, icon: ShieldCheck, badge: "Système", tone: "bg-muted text-muted-foreground" };
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
      <PageHeader
        eyebrow={<><ShieldCheck className="h-3 w-3" /> Audit</>}
        title="Historique entreprise"
        description={`${total} événement(s) tracé(s) · ${logs.length} chargé(s) · Traçabilité complète activée`}
        contained={false}
        className="border-0 bg-transparent px-0 py-0"
        actions={
          <Button onClick={handleExport} disabled={exporting || !canExport} title={!canExport ? "Réservé aux owner/admin" : undefined}>
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Exporter l'historique
          </Button>
        }
      />

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
          {filtered.length > 100 ? (
            <VirtualLogList items={filtered} canSeeDetails={canSeeDetails} />
          ) : (
            <div className="relative pl-8 space-y-4 before:absolute before:left-3 before:top-2 before:bottom-2 before:w-px before:bg-border">
              {filtered.map((l) => (
                <LogRow key={l.id} log={l} canSeeDetails={canSeeDetails} />
              ))}
            </div>
          )}
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

function LogRow({ log: l, canSeeDetails }: { log: Log; canSeeDetails: boolean }) {
  const m = metaFor(l.action);
  const Icon = m.icon;
  return (
    <Card className="p-4 relative">
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
}

/**
 * Virtualisation : kick in seulement >100 items (sinon l'overhead du
 * conteneur scrollable casse la timeline). Hauteurs variables mesurées
 * via measureElement.
 */
function VirtualLogList({ items, canSeeDetails }: { items: Log[]; canSeeDetails: boolean }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 120,
    overscan: 8,
    measureElement: (el) => el?.getBoundingClientRect().height ?? 120,
  });

  return (
    <div
      ref={parentRef}
      className="relative pl-8 max-h-[70vh] overflow-auto rounded border before:absolute before:left-3 before:top-2 before:bottom-2 before:w-px before:bg-border"
    >
      <div style={{ height: rowVirtualizer.getTotalSize(), width: "100%", position: "relative" }}>
        {rowVirtualizer.getVirtualItems().map((v) => {
          const l = items[v.index];
          return (
            <div
              key={l.id}
              data-index={v.index}
              ref={rowVirtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                transform: `translateY(${v.start}px)`,
                padding: "8px 12px 8px 0",
              }}
            >
              <LogRow log={l} canSeeDetails={canSeeDetails} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

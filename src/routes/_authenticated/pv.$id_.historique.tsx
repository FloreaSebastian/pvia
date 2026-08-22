import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
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

export const Route = createFileRoute("/_authenticated/pv/$id_/historique")({
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
  "reserve.status_lifted": { label: "Statut réserve mis à jour", icon: CheckCircle2, badge: "Système", tone: "bg-muted text-muted-foreground" },
  "reserve.validated_by_client": { label: "Réserve validée par le client", icon: CheckCircle2, badge: "Client", tone: "bg-success/15 text-success" },
  "reserve_lift.created": { label: "Levée de réserves créée", icon: ShieldCheck, badge: "Système", tone: "bg-primary/15 text-primary" },
  "reserve_lift.signed": { label: "Levée signée par l'entreprise", icon: PenSquare, badge: "Signature", tone: "bg-success/15 text-success" },
  "reserve_lift.client_validated": { label: "Levée validée par le client", icon: CheckCircle2, badge: "Client", tone: "bg-success/15 text-success" },
  "reserve_lift.client_validated_email_sent": { label: "Email de validation envoyé", icon: Mail, badge: "Email", tone: "bg-primary/15 text-primary" },
  "reserve_lift.client_validated_email_resent": { label: "Email de validation renvoyé", icon: Mail, badge: "Email", tone: "bg-primary/15 text-primary" },
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
  return ACTION_META[action] || { label: action, icon: ShieldCheck, badge: "Système", tone: "bg-muted text-muted-foreground" };
}

const PAGE_SIZE = 50;

const FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "Tous les événements" },
  { value: "pv.", label: "PV" },
  { value: "reserve.", label: "Réserves" },
  { value: "reserve_lift.", label: "Levées de réserves" },
  { value: "photo.", label: "Photos" },
  { value: "member.", label: "Équipe" },
];

const DATE_FMT = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/Paris",
});

/** Projection d'affichage uniquement : la valeur stockée n'est jamais modifiée. */
function formatDate(value: string | null | undefined): string {
  if (!value) return "Date inconnue";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Date inconnue";
  return DATE_FMT.format(d);
}

/** Rend une valeur JSON de façon lisible, jamais "undefined"/"null" brut. */
function renderValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Oui" : "Non";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "—";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return "—";
  }
}

function KeyValues({ data, tone }: { data: Record<string, unknown>; tone?: "old" | "new" }) {
  const entries = Object.entries(data ?? {});
  if (!entries.length) return null;
  return (
    <dl className="min-w-0 space-y-1">
      {entries.map(([k, v]) => (
        <div key={k} className="min-w-0 grid grid-cols-1 gap-x-2 sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)]">
          <dt className="min-w-0 font-medium text-muted-foreground [overflow-wrap:anywhere]">{k}</dt>
          <dd
            className={
              "min-w-0 font-mono [overflow-wrap:anywhere] " +
              (tone === "old" ? "text-destructive/90" : tone === "new" ? "text-success/90" : "")
            }
          >
            {renderValue(v)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

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
  const [exportStatus, setExportStatus] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const prefixFor = (f: string) => (f === "all" ? undefined : f);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const [{ data: pv }, res] = await Promise.all([
          supabase.from("pv").select("numero").eq("id", id).maybeSingle(),
          fetchLogs({ data: { pvId: id, limit: PAGE_SIZE, offset: 0, actionPrefix: prefixFor(filter) } }),
        ]);
        if (cancelled) return;
        setPvNumero(pv?.numero ?? "");
        setLogs(res.logs as Log[]);
        setCanSeeDetails(res.canSeeDetails);
        setTotal(res.total);
        setHasMore(res.hasMore);
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message ?? "Impossible de charger l'historique de ce PV.");
        setLogs([]);
        setTotal(0);
        setHasMore(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, filter]);

  const loadMore = async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetchLogs({
        data: { pvId: id, limit: PAGE_SIZE, offset: logs.length, actionPrefix: prefixFor(filter) },
      });
      setLogs((prev) => [...prev, ...(res.logs as Log[])]);
      setHasMore(res.hasMore);
      setTotal(res.total);
    } catch (e: any) {
      toast.error(e?.message ?? "Erreur lors du chargement des événements suivants.");
    } finally {
      setLoadingMore(false);
    }
  };

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    setExportStatus("Génération du PDF en cours…");
    try {
      const { url } = await exportFn({ data: { pvId: id } });
      if (url) {
        window.open(url, "_blank");
        setExportStatus("PDF de l'historique généré.");
        toast.success("Export PDF généré.");
      } else {
        setExportStatus("Le PDF n'a pas pu être récupéré.");
        toast.error("URL du PDF indisponible.");
      }
    } catch (e: any) {
      setExportStatus(e?.message ?? "Erreur pendant l'export.");
      toast.error(e?.message ?? "Erreur export");
    } finally {
      setExporting(false);
    }
  };

  const activeFilterLabel = useMemo(
    () => FILTERS.find((f) => f.value === filter)?.label ?? "Tous les événements",
    [filter],
  );

  return (
    <div className="container max-w-4xl min-w-0 py-6 sm:py-8 space-y-5 sm:space-y-6">
      <div className="min-w-0 space-y-4 sm:flex sm:items-start sm:justify-between sm:gap-4 sm:space-y-0">
        <div className="min-w-0">
          <Link to="/pv/$id" params={{ id }} className="inline-block">
            <Button
              variant="ghost"
              size="sm"
              className="h-11 gap-1.5 px-3 sm:h-9"
              aria-label="Revenir à la fiche du PV"
            >
              <ArrowLeft className="h-4 w-4" /> Retour au PV
            </Button>
          </Link>
          <h1 className="mt-2 flex min-w-0 items-center gap-2 text-xl font-semibold sm:text-2xl">
            <ShieldCheck className="h-5 w-5 shrink-0 text-success sm:h-6 sm:w-6" />
            <span className="min-w-0 [overflow-wrap:anywhere]">Historique légal</span>
          </h1>
          <p className="mt-1 min-w-0 text-sm text-muted-foreground [overflow-wrap:anywhere]">
            {pvNumero ? (
              <>
                PV <span className="font-mono">{pvNumero}</span> ·{" "}
              </>
            ) : null}
            {total} événement(s) tracé(s) · {logs.length} affiché(s)
          </p>
          <Badge variant="secondary" className="mt-2 gap-1.5 bg-success/15 text-success">
            <ShieldCheck className="h-3 w-3" /> Lecture seule · traçabilité complète
          </Badge>
        </div>

        <div className="grid min-w-0 grid-cols-1 gap-2 sm:flex sm:items-center sm:gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Filter className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger
                className="h-11 w-full min-w-0 sm:h-9 sm:w-[190px]"
                aria-label={`Filtrer les événements — ${activeFilterLabel}`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-w-[calc(100vw-2rem)]">
                {FILTERS.map((f) => (
                  <SelectItem key={f.value} value={f.value}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            onClick={handleExport}
            disabled={exporting}
            className="h-11 w-full min-w-0 sm:h-9 sm:w-auto"
            aria-label="Exporter l'historique légal au format PDF"
            title="Exporter l'historique légal au format PDF"
          >
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            <span className="truncate">{exporting ? "Génération…" : "Exporter PDF"}</span>
          </Button>
        </div>
      </div>

      <p aria-live="polite" className="sr-only">
        {exportStatus}
      </p>

      {loading ? (
        <div className="space-y-4" aria-busy="true" aria-label="Chargement de l'historique">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="p-4">
              <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
              <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-muted" />
            </Card>
          ))}
        </div>
      ) : error ? (
        <Card className="p-8 text-center text-sm">
          <p className="text-destructive [overflow-wrap:anywhere]">{error}</p>
          <p className="mt-2 text-muted-foreground">
            Vérifiez que ce PV existe et que vous y avez accès, puis réessayez.
          </p>
        </Card>
      ) : logs.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground sm:p-12">
          {filter === "all"
            ? "Aucune activité enregistrée pour ce PV."
            : `Aucune activité enregistrée pour la catégorie « ${activeFilterLabel} ».`}
        </Card>
      ) : (
        <div className="min-w-0 space-y-4">
          <ol className="relative min-w-0 space-y-4 pl-7 sm:pl-8 before:absolute before:bottom-2 before:left-[11px] before:top-2 before:w-px before:bg-border sm:before:left-3">
            {logs.map((l, index) => {
              const m = metaFor(l.action);
              const Icon = m.icon;
              return (
                <li key={l.id} className="min-w-0">
                  <Card className="relative min-w-0 overflow-hidden p-3 sm:p-4">
                    <div
                      className="absolute -left-[26px] top-4 flex h-6 w-6 items-center justify-center rounded-full border-2 border-border bg-background sm:-left-[28px]"
                      aria-hidden="true"
                    >
                      <Icon className="h-3 w-3" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5 font-medium">
                        <span className="min-w-0 [overflow-wrap:anywhere]">{m.label}</span>
                        <Badge variant="secondary" className={m.tone + " text-[10px]"}>
                          {m.badge}
                        </Badge>
                        {index === 0 && filter === "all" && (
                          <Badge variant="outline" className="text-[10px]">
                            Plus récent
                          </Badge>
                        )}
                      </div>
                      <div className="mt-0.5 min-w-0 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                        <time dateTime={l.created_at ?? undefined}>{formatDate(l.created_at)}</time>
                        {l.user_name ? (
                          <span>
                            {" "}
                            · par <span className="font-medium text-foreground">{l.user_name}</span>
                          </span>
                        ) : l.user_id ? (
                          <span> · par un utilisateur</span>
                        ) : (
                          <span> · automatique</span>
                        )}
                        {canSeeDetails && l.ip_address && <span className="font-mono"> · {l.ip_address}</span>}
                      </div>
                    </div>

                    {l.metadata && typeof l.metadata === "object" && Object.keys(l.metadata).length > 0 && (
                      <div className="mt-2 min-w-0 rounded bg-muted/40 p-2 text-xs text-muted-foreground">
                        <KeyValues data={l.metadata as Record<string, unknown>} />
                      </div>
                    )}

                    {canSeeDetails && (l.old_values || l.new_values) && (
                      <div className="mt-2 grid min-w-0 gap-2 text-xs sm:grid-cols-2">
                        {l.old_values && (
                          <div className="min-w-0 rounded border border-destructive/20 bg-destructive/5 p-2">
                            <div className="mb-1 font-semibold text-destructive">Avant</div>
                            <KeyValues data={l.old_values as Record<string, unknown>} tone="old" />
                          </div>
                        )}
                        {l.new_values && (
                          <div className="min-w-0 rounded border border-success/20 bg-success/5 p-2">
                            <div className="mb-1 font-semibold text-success">Après</div>
                            <KeyValues data={l.new_values as Record<string, unknown>} tone="new" />
                          </div>
                        )}
                      </div>
                    )}
                  </Card>
                </li>
              );
            })}
          </ol>
          {hasMore && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                onClick={loadMore}
                disabled={loadingMore}
                className="h-11 w-full min-w-0 sm:h-9 sm:w-auto"
                aria-label="Charger plus d'événements"
              >
                {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                <span className="truncate">
                  Charger plus ({logs.length} / {total})
                </span>
              </Button>
            </div>
          )}
        </div>
      )}

      {!canSeeDetails && (
        <p className="text-center text-xs text-muted-foreground">
          Les valeurs détaillées (avant/après, IP) sont réservées aux administrateurs.
        </p>
      )}
    </div>
  );
}


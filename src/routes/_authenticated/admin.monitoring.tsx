import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  listAppErrors, getMonitoringStats, setAppErrorResolved, getHealthStatus, downloadAppErrorsCsv,
  getEmailQueueStats, retryEmailSend, markEmailResolved,
  getWebhookQueueStats, retryWebhookDelivery,
} from "@/lib/monitoring.functions";
import { getRetryQueueStats } from "@/lib/admin-platform.functions";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusPill } from "@/components/ui/status-pill";
import { PageHeader } from "@/components/app/PageHeader";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  Activity, AlertTriangle, AlertCircle, CheckCircle2, Download, Loader2, RefreshCw, ShieldAlert, Server,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/monitoring")({
  component: MonitoringPage,
  head: () => ({ meta: [{ title: "Monitoring — PVIA" }] }),
  beforeLoad: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw redirect({ to: "/login" });
    const { isPlatformAdminEmail } = await import("@/lib/platform-admin");
    if (!isPlatformAdminEmail(user.email)) throw redirect({ to: "/admin/forbidden" });
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "platform_admin").maybeSingle();
    if (!data) throw redirect({ to: "/admin/forbidden" });
  },
});

type AppError = {
  id: string;
  severity: "info" | "warning" | "error" | "critical";
  source: string;
  message: string;
  stack: string | null;
  context: any;
  user_id: string | null;
  company_id: string | null;
  resolved: boolean;
  created_at: string;
};

type Stats = {
  last24h: number;
  last7d: number;
  criticalOpen: number;
  severity7d: Record<string, number>;
  topSources: Array<{ source: string; count: number }>;
};

type HealthCheck = { name: string; ok: boolean; detail?: string };

const SEV_TONE: Record<string, "neutral" | "warning" | "destructive"> = {
  info: "neutral",
  warning: "warning",
  error: "destructive",
  critical: "destructive",
};

function MonitoringPage() {
  const listFn = useServerFn(listAppErrors);
  const statsFn = useServerFn(getMonitoringStats);
  const resolveFn = useServerFn(setAppErrorResolved);
  const healthFn = useServerFn(getHealthStatus);
  const csvFn = useServerFn(downloadAppErrorsCsv);
  const emailQueueFn = useServerFn(getEmailQueueStats);
  const retryEmailFn = useServerFn(retryEmailSend);
  const markEmailFn = useServerFn(markEmailResolved);
  const webhookQueueFn = useServerFn(getWebhookQueueStats);
  const retryWebhookFn = useServerFn(retryWebhookDelivery);

  const retryFn = useServerFn(getRetryQueueStats);

  const [errors, setErrors] = useState<AppError[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<Stats | null>(null);
  const [health, setHealth] = useState<{ checks: HealthCheck[]; at: string } | null>(null);
  const [emailQueue, setEmailQueue] = useState<Awaited<ReturnType<typeof emailQueueFn>> | null>(null);
  const [webhookQueue, setWebhookQueue] = useState<Awaited<ReturnType<typeof webhookQueueFn>> | null>(null);
  const [retry, setRetry] = useState<{
    webhooks: { pending: number; retrying: number; dead: number };
    emails: { pending: number; retrying: number; dead: number };
    retryEvents24h: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [severity, setSeverity] = useState<"all" | "info" | "warning" | "error" | "critical">("all");
  const [resolved, setResolved] = useState<"open" | "resolved" | "all">("open");
  const [source, setSource] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    try {
      const [list, st, hc, rt] = await Promise.all([
        listFn({ data: { severity, resolved, source: source || undefined, limit: 100, offset: 0 } }),
        statsFn(),
        healthFn(),
        retryFn(),
      ]);
      setErrors(list.errors as AppError[]);
      setTotal(list.total);
      setStats(st as Stats);
      setHealth(hc);
      setRetry(rt);
    } catch (e: any) {
      toast.error(e?.message ?? "Erreur");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [severity, resolved]);

  const toggleResolved = async (e: AppError) => {
    try {
      await resolveFn({ data: { id: e.id, resolved: !e.resolved } });
      setErrors((p) => p.map((x) => (x.id === e.id ? { ...x, resolved: !x.resolved } : x)));
    } catch (err: any) {
      toast.error(err?.message ?? "Erreur");
    }
  };

  const downloadCsv = async () => {
    try {
      const { csv, filename } = await csvFn();
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast.error(e?.message ?? "Erreur export");
    }
  };

  return (
    <div className="flex flex-col">
      <PageHeader
        eyebrow={<><ShieldAlert className="h-3 w-3" /> Admin · Monitoring</>}
        title="Monitoring plateforme"
        description="Vue interne — erreurs serveur, santé des services, exports."
        actions={
          <>
            <Button variant="outline" onClick={reload} disabled={loading}>
              <RefreshCw className={"h-4 w-4 " + (loading ? "animate-spin" : "")} /> Actualiser
            </Button>
            <Button onClick={downloadCsv}>
              <Download className="h-4 w-4" /> Télécharger logs CSV
            </Button>
          </>
        }
      />
      <div className="container max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">

      {/* Stats */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><Activity className="h-3 w-3" /> 24h</div>
          <div className="text-2xl font-semibold mt-1">{stats?.last24h ?? "—"}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">7 jours</div>
          <div className="text-2xl font-semibold mt-1">{stats?.last7d ?? "—"}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-destructive" /> Critiques ouvertes</div>
          <div className="text-2xl font-semibold mt-1 text-destructive">{stats?.criticalOpen ?? "—"}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Erreurs 7j (par sévérité)</div>
          <div className="flex flex-wrap gap-1.5 mt-2 text-xs">
            {stats && (["critical", "error", "warning", "info"] as const).map((s) => (
              <StatusPill key={s} tone={SEV_TONE[s]} size="sm">
                {s}: {stats.severity7d[s] ?? 0}
              </StatusPill>
            ))}
          </div>
        </Card>
      </div>

      {/* Retry queues */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Webhooks en attente</div>
          <div className="text-2xl font-semibold mt-1">{(retry?.webhooks.pending ?? 0) + (retry?.webhooks.retrying ?? 0)}</div>
          <div className="text-[11px] text-muted-foreground mt-1">pending {retry?.webhooks.pending ?? 0} · retrying {retry?.webhooks.retrying ?? 0}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Emails en attente</div>
          <div className="text-2xl font-semibold mt-1">{(retry?.emails.pending ?? 0) + (retry?.emails.retrying ?? 0)}</div>
          <div className="text-[11px] text-muted-foreground mt-1">failed {retry?.emails.pending ?? 0} · retrying {retry?.emails.retrying ?? 0}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-destructive" /> Dead letters</div>
          <div className="text-2xl font-semibold mt-1 text-destructive">{(retry?.webhooks.dead ?? 0) + (retry?.emails.dead ?? 0)}</div>
          <div className="text-[11px] text-muted-foreground mt-1">wh {retry?.webhooks.dead ?? 0} · em {retry?.emails.dead ?? 0}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Évènements retry 24h</div>
          <div className="text-2xl font-semibold mt-1">{retry?.retryEvents24h ?? 0}</div>
        </Card>
      </div>

      {/* Health */}
      <Card className="p-4">
        <h2 className="font-semibold flex items-center gap-2 mb-3"><Server className="h-4 w-4" /> Santé des services</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {health?.checks.map((c) => (
            <div key={c.name} className={"flex items-center justify-between rounded-md border p-2 " + (c.ok ? "border-success/30 bg-success/10" : "border-destructive/30 bg-destructive/10")}>
              <div className="text-sm">
                <div className="font-medium">{c.name}</div>
                {c.detail && <div className="text-xs text-muted-foreground">{c.detail}</div>}
              </div>
              {c.ok ? <CheckCircle2 className="h-5 w-5 text-success" /> : <AlertCircle className="h-5 w-5 text-destructive" />}
            </div>
          ))}
        </div>
        {health?.at && <p className="text-[11px] text-muted-foreground mt-2">Mesuré à {new Date(health.at).toLocaleTimeString("fr-FR")}</p>}
      </Card>

      {/* Top sources */}
      {stats && stats.topSources.length > 0 && (
        <Card className="p-4">
          <h2 className="font-semibold mb-3">Top sources d'erreurs (7j)</h2>
          <div className="flex flex-wrap gap-2">
            {stats.topSources.map((t) => (
              <Badge key={t.source} variant="outline" className="font-mono cursor-pointer" onClick={() => setSource(t.source)}>
                {t.source} <span className="ml-1 text-muted-foreground">×{t.count}</span>
              </Badge>
            ))}
          </div>
        </Card>
      )}

      {/* Filters */}
      <Card className="p-4 flex flex-wrap gap-3 items-center">
        <Select value={severity} onValueChange={(v) => setSeverity(v as any)}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes sévérités</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="error">Error</SelectItem>
            <SelectItem value="warning">Warning</SelectItem>
            <SelectItem value="info">Info</SelectItem>
          </SelectContent>
        </Select>
        <Select value={resolved} onValueChange={(v) => setResolved(v as any)}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Non résolues</SelectItem>
            <SelectItem value="resolved">Résolues</SelectItem>
            <SelectItem value="all">Toutes</SelectItem>
          </SelectContent>
        </Select>
        <Input
          value={source}
          onChange={(e) => setSource(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") reload(); }}
          placeholder="Filtrer par source (ex: http:/api)"
          className="max-w-xs"
        />
        <Button variant="outline" size="sm" onClick={reload}>Appliquer</Button>
        <span className="text-xs text-muted-foreground ml-auto">{total} erreur(s)</span>
      </Card>

      {/* List */}
      {loading ? (
        <Card className="p-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></Card>
      ) : errors.length === 0 ? (
        <Card className="p-12 text-center text-sm text-muted-foreground">Aucune erreur 🎉</Card>
      ) : (
        <div className="space-y-2">
          {errors.map((e) => (
            <Card key={e.id} className={"p-3 " + (e.resolved ? "opacity-60" : "")}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <StatusPill tone={SEV_TONE[e.severity]} size="sm" dot>{e.severity}</StatusPill>
                    <code className="text-xs font-mono text-muted-foreground">{e.source}</code>
                    <span className="text-[11px] text-muted-foreground">{new Date(e.created_at).toLocaleString("fr-FR")}</span>
                  </div>
                  <div className="text-sm mt-1 break-words">{e.message}</div>
                  {expanded === e.id && (
                    <div className="mt-2 space-y-2">
                      {e.context && (
                        <pre className="text-[11px] bg-muted/40 rounded p-2 font-mono overflow-x-auto">
                          {JSON.stringify(e.context, null, 2)}
                        </pre>
                      )}
                      {e.stack && (
                        <pre className="text-[11px] bg-destructive/10 text-destructive rounded p-2 font-mono overflow-x-auto whitespace-pre-wrap">
                          {e.stack}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex gap-1">
                  {(e.stack || e.context) && (
                    <Button size="sm" variant="ghost" onClick={() => setExpanded(expanded === e.id ? null : e.id)}>
                      {expanded === e.id ? "Masquer" : "Détails"}
                    </Button>
                  )}
                  <Button size="sm" variant={e.resolved ? "ghost" : "outline"} onClick={() => toggleResolved(e)}>
                    {e.resolved ? "Rouvrir" : "Résoudre"}
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}

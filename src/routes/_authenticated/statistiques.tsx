import { createFileRoute } from "@tanstack/react-router";
import { ADMIN_ROLES, OWNER_ROLES, SIGN_ROLES, isAdminRole, isManageRole } from "@/lib/roles";
import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import {
  BarChart3, FileText, PenSquare, Clock, AlertCircle, Mail, Camera, Loader2,
  TrendingUp, TrendingDown, Minus, CheckCircle2, XCircle, Send, CalendarIcon,
  Download, FileSpreadsheet, AlertTriangle,
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  PieChart, Pie, Cell, BarChart, Bar,
} from "recharts";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useServerFn } from "@tanstack/react-start";
import { getCompanyStats, exportCompanyStatsCsv, exportCompanyStatsPdf } from "@/lib/stats.functions";
import { useCompany } from "@/hooks/use-company";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { PageHeader } from "@/components/app/PageHeader";

export const Route = createFileRoute("/_authenticated/statistiques")({
  component: StatistiquesPage,
  head: () => ({ meta: [{ title: "Statistiques — PVIA" }] }),
});

type Stats = Awaited<ReturnType<typeof getCompanyStats>>;

const PIE_COLORS = ["oklch(0.72 0.15 70)", "oklch(0.62 0.16 152)", "oklch(0.6 0.18 250)"];
const SEV_COLORS = ["oklch(0.6 0.18 250)", "oklch(0.72 0.15 70)", "oklch(0.6 0.22 25)"];

function deltaPct(curV: number, prevV: number | undefined | null): number | null {
  if (prevV === undefined || prevV === null) return null;
  if (prevV === 0 && curV === 0) return 0;
  if (prevV === 0) return null;
  return ((curV - prevV) / prevV) * 100;
}

function DeltaBadge({
  cur, prev, invert = false,
}: { cur: number; prev?: number | null; invert?: boolean }) {
  const d = deltaPct(cur, prev ?? null);
  if (d === null) return <span className="text-[10px] text-muted-foreground">—</span>;
  const up = d > 0;
  const flat = d === 0;
  // invert: when "going up" is bad (e.g. emails failed, reserves ouvertes, délai)
  const isPositive = flat ? null : invert ? !up : up;
  const tone = isPositive === null
    ? "bg-muted text-muted-foreground"
    : isPositive ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive";
  const Icon = flat ? Minus : up ? TrendingUp : TrendingDown;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium", tone)}>
      <Icon className="h-3 w-3" />
      {d > 0 ? "+" : ""}{d.toFixed(1)}%
    </span>
  );
}

function KpiCard({
  icon: Icon, label, value, hint, tone = "default", delta,
}: {
  icon: any; label: string; value: React.ReactNode; hint?: string;
  tone?: "default" | "success" | "warning" | "danger";
  delta?: React.ReactNode;
}) {
  const tones: Record<string, string> = {
    default: "bg-primary/10 text-primary",
    success: "bg-success/15 text-success",
    warning: "bg-warning/15 text-warning",
    danger: "bg-destructive/15 text-destructive",
  };
  return (
    <Card className="group relative overflow-hidden p-5 transition hover:-translate-y-0.5 hover:shadow-brand">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
          <div className="mt-1 flex items-center gap-2">
            {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
            {delta}
          </div>
        </div>
        <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${tones[tone]}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </Card>
  );
}

function StatistiquesPage() {
  const { activeCompanyId, activeRole } = useCompany();
  const fetchStats = useServerFn(getCompanyStats);
  const exportCsv = useServerFn(exportCompanyStatsCsv);
  const exportPdf = useServerFn(exportCompanyStatsPdf);

  const canExport = (SIGN_ROLES as readonly string[]).includes(activeRole as string);

  const [days, setDays] = useState<string>("30");
  const [from, setFrom] = useState<Date | undefined>();
  const [to, setTo] = useState<Date | undefined>();
  const [pvType, setPvType] = useState<string>("all");
  const [userId, setUserId] = useState<string>("all");
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<"csv" | "pdf" | null>(null);

  const isCustom = days === "custom";
  const customValid = isCustom && from && to && from.getTime() <= to.getTime();

  useEffect(() => {
    if (!activeCompanyId) return;
    if (isCustom && !customValid) return;
    let cancelled = false;
    setLoading(true);
    fetchStats({
      data: {
        companyId: activeCompanyId,
        days: isCustom || days === "all" ? undefined : Number(days),
        from: isCustom && from ? from.toISOString() : undefined,
        to: isCustom && to ? to.toISOString() : undefined,
        pvType: pvType === "all" ? undefined : pvType,
        userId: userId === "all" ? undefined : userId,
        compare: true,
      },
    })
      .then((s) => { if (!cancelled) setStats(s as Stats); })
      .catch((e) => console.error(e))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeCompanyId, days, from, to, pvType, userId, isCustom, customValid, fetchStats]);

  const monthly = useMemo(() => {
    return (stats?.monthly ?? []).map((m) => ({
      ...m,
      label: new Date(m.month + "-01").toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }),
    }));
  }, [stats]);

  const delayLabel = useMemo(() => {
    const h = stats?.kpis.avgDelayHours ?? 0;
    if (!h) return "—";
    if (h < 24) return `${h.toFixed(1)} h`;
    return `${(h / 24).toFixed(1)} j`;
  }, [stats]);

  const alerts = useMemo(() => {
    if (!stats) return [] as { level: "warning" | "danger"; icon: any; label: string }[];
    const k = stats.kpis;
    const out: { level: "warning" | "danger"; icon: any; label: string }[] = [];
    if (k.totalPv >= 5 && k.signatureRate < 50) {
      out.push({ level: "danger", icon: PenSquare, label: `Taux de signature faible (${k.signatureRate}%) — relancez les clients.` });
    }
    if (k.reservesOuverte >= 10) {
      out.push({ level: "warning", icon: AlertCircle, label: `${k.reservesOuverte} réserves ouvertes — pensez à les traiter.` });
    }
    if (k.emailsFailed > 0) {
      out.push({ level: "danger", icon: Mail, label: `${k.emailsFailed} email(s) échoué(s) sur la période.` });
    }
    if (k.avgDelayHours > 168) { // > 7 days
      out.push({ level: "warning", icon: Clock, label: `Délai moyen de signature élevé (${(k.avgDelayHours / 24).toFixed(1)} jours).` });
    }
    if (stats.pendingOver7Days > 0) {
      out.push({ level: "warning", icon: FileText, label: `${stats.pendingOver7Days} PV en attente depuis plus de 7 jours.` });
    }
    return out;
  }, [stats]);

  function buildExportInput() {
    return {
      companyId: activeCompanyId!,
      days: isCustom || days === "all" ? undefined : Number(days),
      from: isCustom && from ? from.toISOString() : undefined,
      to: isCustom && to ? to.toISOString() : undefined,
      pvType: pvType === "all" ? undefined : pvType,
      userId: userId === "all" ? undefined : userId,
    };
  }

  async function onExportCsv() {
    if (!activeCompanyId) return;
    setExporting("csv");
    try {
      const res = await exportCsv({ data: buildExportInput() });
      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = res.fileName; a.click();
      URL.revokeObjectURL(url);
      toast.success("Export CSV téléchargé.");
    } catch (e: any) {
      toast.error(e.message ?? "Erreur lors de l'export.");
    } finally {
      setExporting(null);
    }
  }

  async function onExportPdf() {
    if (!activeCompanyId) return;
    setExporting("pdf");
    try {
      const res = await exportPdf({ data: buildExportInput() });
      if (res.url) {
        window.open(res.url, "_blank");
        toast.success("PDF généré.");
      } else {
        toast.error("Impossible de générer le PDF.");
      }
    } catch (e: any) {
      toast.error(e.message ?? "Erreur lors de l'export.");
    } finally {
      setExporting(null);
    }
  }

  if (!activeCompanyId) {
    return <div className="p-8 text-sm text-muted-foreground">Sélectionnez une entreprise.</div>;
  }

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        eyebrow={<><BarChart3 className="h-3 w-3" /> Analytics</>}
        title="Statistiques"
        description="Vue temps réel avec comparaison à la période précédente."
        contained={false}
        className="border-0 bg-transparent px-0 py-0"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onExportCsv} disabled={!canExport || !!exporting}>
              {exporting === "csv" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
              CSV
            </Button>
            <Button variant="outline" size="sm" onClick={onExportPdf} disabled={!canExport || !!exporting}>
              {exporting === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              PDF
            </Button>
          </div>
        }
      />

      {!canExport && (
        <p className="text-xs text-muted-foreground">L'export est réservé aux rôles Owner, Admin et Manager.</p>
      )}

      {/* Filters */}
      <Card className="p-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Période</span>
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-[150px] h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 jours</SelectItem>
              <SelectItem value="30">30 jours</SelectItem>
              <SelectItem value="90">90 jours</SelectItem>
              <SelectItem value="365">12 mois</SelectItem>
              <SelectItem value="all">Tout</SelectItem>
              <SelectItem value="custom">Personnalisée</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isCustom && (
          <>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className={cn("h-9 justify-start", !from && "text-muted-foreground")}>
                  <CalendarIcon className="h-4 w-4" />
                  {from ? format(from, "dd MMM yyyy", { locale: fr }) : "Début"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={from} onSelect={setFrom} initialFocus className="p-3 pointer-events-auto" />
              </PopoverContent>
            </Popover>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className={cn("h-9 justify-start", !to && "text-muted-foreground")}>
                  <CalendarIcon className="h-4 w-4" />
                  {to ? format(to, "dd MMM yyyy", { locale: fr }) : "Fin"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={to}
                  onSelect={setTo}
                  disabled={(d) => (from ? d < from : false)}
                  initialFocus
                  className="p-3 pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
            {isCustom && (!from || !to) && (
              <span className="text-xs text-warning">Sélectionnez les deux dates.</span>
            )}
          </>
        )}

        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Type PV</span>
          <Select value={pvType} onValueChange={setPvType}>
            <SelectTrigger className="w-[170px] h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous types</SelectItem>
              <SelectItem value="reception">Réception</SelectItem>
              <SelectItem value="livraison">Livraison</SelectItem>
              <SelectItem value="reserve">Levée de réserve</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Utilisateur</span>
          <Select value={userId} onValueChange={setUserId}>
            <SelectTrigger className="w-[200px] h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les membres</SelectItem>
              {(stats?.members ?? []).map((m) => (
                <SelectItem key={m.user_id} value={m.user_id}>{m.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground ml-auto" />}
      </Card>

      {/* Smart alerts */}
      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map((a, i) => {
            const Icon = a.icon;
            const tone = a.level === "danger"
              ? "bg-destructive/10 border-destructive/30 text-destructive"
              : "bg-warning/10 border-warning/30 text-warning";
            return (
              <Card key={i} className={cn("p-3 flex items-center gap-3 border", tone)}>
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <Icon className="h-4 w-4 shrink-0" />
                <span className="text-sm">{a.label}</span>
              </Card>
            );
          })}
        </div>
      )}

      {!stats ? (
        <Card className="p-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></Card>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard icon={FileText} label="PV créés" value={stats.kpis.totalPv}
              delta={<DeltaBadge cur={stats.kpis.totalPv} prev={stats.previous?.totalPv} />} />
            <KpiCard icon={PenSquare} label="PV signés" value={stats.kpis.signedPv} tone="success"
              hint={`Taux ${stats.kpis.signatureRate}%`}
              delta={<DeltaBadge cur={stats.kpis.signedPv} prev={stats.previous?.signedPv} />} />
            <KpiCard icon={Clock} label="Délai moyen signature" value={delayLabel} tone="warning"
              delta={<DeltaBadge cur={stats.kpis.avgDelayHours} prev={stats.previous?.avgDelayHours} invert />} />
            <KpiCard icon={AlertCircle} label="Réserves" value={stats.kpis.reservesTotal}
              hint={`${stats.kpis.reservesOuverte} ouvertes`}
              delta={<DeltaBadge cur={stats.kpis.reservesOuverte} prev={stats.previous?.reservesOuverte} invert />} />
            <KpiCard icon={Send} label="Envoyés au client" value={stats.kpis.sentToClient}
              delta={<DeltaBadge cur={stats.kpis.sentToClient} prev={stats.previous?.sentToClient} />} />
            <KpiCard icon={FileText} label="PDF générés" value={stats.kpis.pdfGenerated}
              delta={<DeltaBadge cur={stats.kpis.pdfGenerated} prev={stats.previous?.pdfGenerated} />} />
            <KpiCard icon={Mail} label="Emails envoyés" value={stats.kpis.emailsSent} tone="success"
              hint={stats.kpis.emailsFailed ? `${stats.kpis.emailsFailed} échec(s)` : "0 échec"}
              delta={<DeltaBadge cur={stats.kpis.emailsSent} prev={stats.previous?.emailsSent} />} />
            <KpiCard icon={Camera} label="Photos ajoutées" value={stats.kpis.photosTotal}
              delta={<DeltaBadge cur={stats.kpis.photosTotal} prev={stats.previous?.photosTotal} />} />
          </div>

          {/* Trend chart */}
          <Card className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="h-4 w-4 text-primary" />
              <h2 className="font-semibold">Évolution mensuelle des PV</h2>
            </div>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={monthly}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="label" className="text-xs" />
                  <YAxis allowDecimals={false} className="text-xs" />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="created" name="Créés" stroke="hsl(217 91% 60%)" strokeWidth={2} dot />
                  <Line type="monotone" dataKey="signed" name="Signés" stroke="hsl(142 71% 45%)" strokeWidth={2} dot />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                <h2 className="font-semibold">Réserves par statut</h2>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={stats.reservesByStatus} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                      {stats.reservesByStatus.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <XCircle className="h-4 w-4 text-primary" />
                <h2 className="font-semibold">Réserves par gravité</h2>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats.reservesBySeverity}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="name" className="text-xs" />
                    <YAxis allowDecimals={false} className="text-xs" />
                    <Tooltip />
                    <Bar dataKey="value" name="Réserves" radius={[6, 6, 0, 0]}>
                      {stats.reservesBySeverity.map((_, i) => (
                        <Cell key={i} fill={SEV_COLORS[i % SEV_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          <Card className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="h-4 w-4 text-primary" />
              <h2 className="font-semibold">Activité par utilisateur</h2>
              <span className="text-xs text-muted-foreground ml-2">(actions tracées sur la période)</span>
            </div>
            {stats.activityByUser.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-8">Aucune activité tracée.</div>
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats.activityByUser} layout="vertical" margin={{ left: 30 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis type="number" allowDecimals={false} className="text-xs" />
                    <YAxis type="category" dataKey="name" width={140} className="text-xs" />
                    <Tooltip />
                    <Bar dataKey="count" name="Actions" fill="hsl(217 91% 60%)" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

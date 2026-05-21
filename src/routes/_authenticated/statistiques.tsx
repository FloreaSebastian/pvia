import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  BarChart3, FileText, PenSquare, Clock, AlertCircle, Mail, Camera, Loader2,
  TrendingUp, CheckCircle2, XCircle, Send,
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  PieChart, Pie, Cell, BarChart, Bar,
} from "recharts";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useServerFn } from "@tanstack/react-start";
import { getCompanyStats } from "@/lib/stats.functions";
import { useCompany } from "@/hooks/use-company";

export const Route = createFileRoute("/_authenticated/statistiques")({
  component: StatistiquesPage,
  head: () => ({ meta: [{ title: "Statistiques — PVIA" }] }),
});

type Stats = Awaited<ReturnType<typeof getCompanyStats>>;

const PIE_COLORS = ["hsl(35 92% 55%)", "hsl(142 71% 45%)", "hsl(217 91% 60%)"];
const SEV_COLORS = ["hsl(217 91% 60%)", "hsl(35 92% 55%)", "hsl(0 84% 60%)"];

function KpiCard({
  icon: Icon, label, value, hint, tone = "default",
}: { icon: any; label: string; value: React.ReactNode; hint?: string; tone?: "default" | "success" | "warning" | "danger" }) {
  const tones: Record<string, string> = {
    default: "bg-primary/10 text-primary",
    success: "bg-emerald-100 text-emerald-700",
    warning: "bg-amber-100 text-amber-700",
    danger: "bg-red-100 text-red-700",
  };
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold">{value}</p>
          {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        </div>
        <div className={`rounded-lg p-2 ${tones[tone]}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </Card>
  );
}

function StatistiquesPage() {
  const { activeCompanyId } = useCompany();
  const fetchStats = useServerFn(getCompanyStats);

  const [days, setDays] = useState<string>("30");
  const [pvType, setPvType] = useState<string>("all");
  const [userId, setUserId] = useState<string>("all");
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeCompanyId) return;
    let cancelled = false;
    setLoading(true);
    fetchStats({
      data: {
        companyId: activeCompanyId,
        days: days === "all" ? undefined : Number(days),
        pvType: pvType === "all" ? undefined : pvType,
        userId: userId === "all" ? undefined : userId,
      },
    })
      .then((s) => { if (!cancelled) setStats(s as Stats); })
      .catch((e) => console.error(e))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeCompanyId, days, pvType, userId, fetchStats]);

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

  if (!activeCompanyId) {
    return <div className="p-8 text-sm text-muted-foreground">Sélectionnez une entreprise.</div>;
  }

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <BarChart3 className="h-3.5 w-3.5" /> Analytics
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Statistiques</h1>
          <p className="text-sm text-muted-foreground">Vue temps réel de l'activité de votre entreprise.</p>
        </div>
      </div>

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
            </SelectContent>
          </Select>
        </div>
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

      {!stats ? (
        <Card className="p-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></Card>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard icon={FileText} label="PV créés" value={stats.kpis.totalPv} />
            <KpiCard icon={PenSquare} label="PV signés" value={stats.kpis.signedPv} tone="success"
              hint={`Taux ${stats.kpis.signatureRate}%`} />
            <KpiCard icon={Clock} label="Délai moyen signature" value={delayLabel} tone="warning" />
            <KpiCard icon={AlertCircle} label="Réserves" value={stats.kpis.reservesTotal}
              hint={`${stats.kpis.reservesOuverte} ouvertes`} />
            <KpiCard icon={Send} label="Envoyés au client" value={stats.kpis.sentToClient} />
            <KpiCard icon={FileText} label="PDF générés" value={stats.kpis.pdfGenerated} tone="default" />
            <KpiCard icon={Mail} label="Emails envoyés" value={stats.kpis.emailsSent} tone="success"
              hint={stats.kpis.emailsFailed ? `${stats.kpis.emailsFailed} échec(s)` : "0 échec"} />
            <KpiCard icon={Camera} label="Photos ajoutées" value={stats.kpis.photosTotal} />
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
            {/* Reserves by status (donut) */}
            <Card className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                <h2 className="font-semibold">Réserves par statut</h2>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={stats.reservesByStatus}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={55}
                      outerRadius={90}
                      paddingAngle={2}
                    >
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

            {/* Reserves by severity */}
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

          {/* Activity by user */}
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

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import {
  FileText,
  HardHat,
  CheckCircle2,
  Plus,
  ArrowUpRight,
  Clock,
  AlertCircle,
  TrendingUp,
  Activity,
  PenLine,
  Camera,
  Sparkles,
  CalendarDays,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { AnimatedCounter } from "@/components/app/AnimatedCounter";
import { PvStatusPill } from "@/components/ui/status-pill";
import { PageHeader } from "@/components/app/PageHeader";
import { Sparkline } from "@/components/app/Sparkline";
import { useCompany } from "@/hooks/use-company";
import { useContainerWidth } from "@/hooks/use-viewport";
import { ComplianceWidget } from "@/components/dashboard/ComplianceWidget";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
  head: () => ({ meta: [{ title: "Tableau de bord — PVIA" }] }),
});

type Stats = { pv: number; signed: number; pending: number; openReserves: number };
type Pv = { id: string; numero: string; status: string; created_at: string; reception_date: string | null };
type Ch = { id: string; name: string; status: string; address: string | null; created_at: string };
type Activity = { id: string; type: "pv" | "reserve" | "chantier"; label: string; at: string };

/** Build a 14-day series of PV creation counts from a list of timestamps. */
function buildDailySeries(items: { created_at: string }[], days = 14): number[] {
  const buckets = new Array(days).fill(0);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  for (const item of items) {
    const d = new Date(item.created_at);
    d.setHours(0, 0, 0, 0);
    const diff = Math.floor((now.getTime() - d.getTime()) / 86400000);
    if (diff >= 0 && diff < days) buckets[days - 1 - diff] += 1;
  }
  return buckets;
}

/**
 * Bloc « Derniers procès-verbaux ».
 * S'adapte à la largeur réellement disponible (container query JS partagée) :
 * liste de lignes tactiles sous ~30rem (Fold fermé / smartphone étroit),
 * tableau inchangé au-delà.
 */
function RecentPvCard({ recent }: { recent: Pv[] }) {
  const { ref, width } = useContainerWidth<HTMLDivElement>();
  // width === 0 au premier rendu (SSR / avant mesure) : on part du tableau desktop.
  const isNarrow = width > 0 && width < 480;

  const empty = (
    <div className="px-3 py-10 text-center">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary">
        <FileText className="h-5 w-5" />
      </div>
      <p className="mt-3 text-sm font-medium">Aucun PV pour le moment</p>
      <p className="mx-auto mt-0.5 max-w-[26ch] text-xs text-muted-foreground">
        Démarrez en créant votre premier procès-verbal.
      </p>
      <div className="mt-4 flex justify-center">
        <Link to="/pv/new" search={{ fresh: 1 }} className="min-w-0 max-w-full">
          <Button size="sm" className="max-w-full shadow-brand">
            <Plus className="h-3 w-3 shrink-0" />
            <span className="truncate">Créer le premier PV</span>
          </Button>
        </Link>
      </div>
    </div>
  );

  return (
    <Card ref={ref} className="p-4 sm:p-6 lg:col-span-2">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          <h3 className="font-display font-semibold">Derniers procès-verbaux</h3>
          <p className="text-xs text-muted-foreground">Vos PV les plus récents.</p>
        </div>
        <Link
          to="/pv"
          className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          Voir tout <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>

      {isNarrow ? (
        <div className="mt-4 overflow-hidden rounded-lg border border-border bg-card">
          {recent.length === 0 ? (
            empty
          ) : (
            <ul className="divide-y divide-border">
              {recent.map((r) => (
                <li key={r.id}>
                  <Link
                    to="/pv/$id"
                    params={{ id: r.id }}
                    className="flex min-h-[56px] items-center gap-2 px-3 py-2.5 transition-colors hover:bg-muted/40 active:bg-muted/60"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{r.numero}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {new Date(r.created_at).toLocaleDateString("fr-FR", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </div>
                    </div>
                    <div className="shrink-0">
                      <PvStatusPill status={r.status} size="sm" />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="mt-4 overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">Numéro</th>
                <th className="px-4 py-2.5 text-left font-medium">Date</th>
                <th className="px-4 py-2.5 text-right font-medium">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-card">
              {recent.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-12 text-center">
                    {empty}
                  </td>
                </tr>
              )}
              {recent.map((r) => (
                <tr key={r.id} className="transition-colors hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium">{r.numero}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(r.created_at).toLocaleDateString("fr-FR")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <PvStatusPill status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Dashboard() {
  const { activeCompanyId, can } = useCompany();
  const canWrite = can("manage");
  const [stats, setStats] = useState<Stats>({ pv: 0, signed: 0, pending: 0, openReserves: 0 });
  const [recent, setRecent] = useState<Pv[]>([]);
  const [chantiers, setChantiers] = useState<Ch[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [trendData, setTrendData] = useState<{ created_at: string }[]>([]);
  const [signedTrend, setSignedTrend] = useState<{ created_at: string }[]>([]);
  const [pendingTrend, setPendingTrend] = useState<{ created_at: string }[]>([]);
  const [reservesTrend, setReservesTrend] = useState<{ created_at: string }[]>([]);
  const [prevPvCount, setPrevPvCount] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!activeCompanyId) return;
    let cancelled = false;
    (async () => {
      setLoaded(false);
      const base = () => supabase.from("pv").select("id", { count: "exact", head: true }).eq("company_id", activeCompanyId);
      const since = new Date(Date.now() - 14 * 86400000).toISOString();
      const prevSince = new Date(Date.now() - 28 * 86400000).toISOString();
      const [pv, signed, pending, reserves, rec, chs, trend, prevTrend, signedRows, pendingRows, openReserveRows] =
        await Promise.all([
          base(),
          base().eq("status", "signe"),
          base().eq("status", "brouillon"),
          supabase.from("pv_reserves").select("id", { count: "exact", head: true }).eq("status", "ouverte").eq("company_id", activeCompanyId),
          supabase.from("pv").select("id,numero,status,created_at,reception_date,signed_at").eq("company_id", activeCompanyId).order("created_at", { ascending: false }).limit(6),
          supabase.from("chantiers").select("id,name,status,address,created_at").eq("company_id", activeCompanyId).order("created_at", { ascending: false }).limit(4),
          supabase.from("pv").select("created_at").eq("company_id", activeCompanyId).gte("created_at", since),
          supabase.from("pv").select("id", { count: "exact", head: true }).eq("company_id", activeCompanyId).gte("created_at", prevSince).lt("created_at", since),
          supabase.from("pv").select("signed_at").eq("company_id", activeCompanyId).eq("status", "signe").gte("signed_at", since),
          supabase.from("pv").select("created_at").eq("company_id", activeCompanyId).eq("status", "brouillon").gte("created_at", since),
          supabase.from("pv_reserves").select("created_at").eq("company_id", activeCompanyId).eq("status", "ouverte").gte("created_at", since),
        ]);
      if (cancelled) return;
      setStats({
        pv: pv.count ?? 0,
        signed: signed.count ?? 0,
        pending: pending.count ?? 0,
        openReserves: reserves.count ?? 0,
      });
      setRecent((rec.data ?? []) as Pv[]);
      setChantiers(chs.data ?? []);
      setTrendData(trend.data ?? []);
      setPrevPvCount(prevTrend.count ?? 0);
      setSignedTrend(
        ((signedRows.data ?? []) as { signed_at: string | null }[])
          .filter((r) => !!r.signed_at)
          .map((r) => ({ created_at: r.signed_at as string })),
      );
      setPendingTrend((pendingRows.data ?? []) as { created_at: string }[]);
      setReservesTrend((openReserveRows.data ?? []) as { created_at: string }[]);

      const acts: Activity[] = ((rec.data ?? []) as Pv[]).slice(0, 5).map((p) => ({
        id: p.id,
        type: "pv",
        label: p.status === "signe" ? `PV ${p.numero} signé` : `PV ${p.numero} créé`,
        // Un PV signé est daté de sa signature, pas de sa création.
        at: (p.status === "signe" && p.signed_at) || p.created_at,
      }));
      setActivity(acts);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeCompanyId]);

  const series14 = useMemo(() => buildDailySeries(trendData, 14), [trendData]);
  const signedSeries = useMemo(() => buildDailySeries(signedTrend, 14), [signedTrend]);
  const pendingSeries = useMemo(() => buildDailySeries(pendingTrend, 14), [pendingTrend]);
  const reservesSeries = useMemo(() => buildDailySeries(reservesTrend, 14), [reservesTrend]);
  const max14 = Math.max(1, ...series14);

  /** Évolution réelle des PV créés : 14 derniers jours vs les 14 précédents. */
  const pvDelta = useMemo(() => {
    const current = trendData.length;
    if (prevPvCount === 0) return current > 0 ? `+${current} sur 14 j` : "Aucun PV sur 14 j";
    const pct = Math.round(((current - prevPvCount) / prevPvCount) * 100);
    return `${pct >= 0 ? "+" : ""}${pct}% vs 14 j précédents`;
  }, [trendData.length, prevPvCount]);

  const kpis = [
    {
      label: "PV créés",
      value: stats.pv,
      icon: FileText,
      tone: "text-primary",
      bg: "bg-primary/10",
      trend: pvDelta,
      spark: series14,
      sparkLabel: "PV créés par jour sur 14 jours",
    },
    {
      label: "PV signés",
      value: stats.signed,
      icon: CheckCircle2,
      tone: "text-success",
      bg: "bg-success/10",
      trend: `${stats.pv ? Math.round((stats.signed / stats.pv) * 100) : 0}% de taux`,
      spark: signedSeries,
      sparkLabel: "PV signés par jour sur 14 jours",
    },
    {
      label: "PV en attente",
      value: stats.pending,
      icon: Clock,
      tone: "text-warning",
      bg: "bg-warning/10",
      trend: stats.pending > 0 ? "Brouillons à finaliser" : "Rien à finaliser",
      spark: pendingSeries,
      sparkLabel: "Brouillons créés par jour sur 14 jours",
    },
    {
      label: "Réserves ouvertes",
      value: stats.openReserves,
      icon: AlertCircle,
      tone: "text-destructive",
      bg: "bg-destructive/10",
      trend: stats.openReserves > 0 ? "À traiter" : "Aucune réserve ouverte",
      spark: reservesSeries,
      sparkLabel: "Réserves ouvertes créées par jour sur 14 jours",
    },
  ];


  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={<><Sparkles className="h-3 w-3" /> Bienvenue</>}
        title="Tableau de bord"
        description="Vue d'ensemble de votre activité chantier."
        contained={false}
        className="border-0 bg-transparent px-0 py-0"
        actions={
          <Link to="/pv/new" search={{ fresh: 1 }}>
            <Button size="lg" className="shadow-brand">
              <Plus className="h-4 w-4" /> Créer un nouveau PV
            </Button>
          </Link>
        }
      />

      {/* KPI cards with sparklines */}
      <div className="auto-grid">
        {kpis.map((k, i) => (
          <motion.div
            key={k.label}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: i * 0.06 }}
          >
            <Card className="group relative overflow-hidden p-5 transition-all hover:-translate-y-0.5 hover:shadow-lg">
              <div className="relative flex items-start justify-between">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {k.label}
                  </p>
                  <p className="mt-3 font-display text-3xl font-bold tracking-tight">
                    {loaded ? <AnimatedCounter value={k.value} /> : 0}
                  </p>
                  <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <TrendingUp className="h-3 w-3" /> {k.trend}
                  </p>
                </div>
                <div className={`rounded-lg p-2 ${k.bg} ${k.tone}`}>
                  <k.icon className="h-4 w-4" />
                </div>
              </div>
              <div className={`relative mt-4 h-10 ${k.tone}`}>
                <Sparkline values={k.spark} />
              </div>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Activity chart + feed */}
      <div className="auto-grid-lg">
        <Card className="p-6 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-display font-semibold">Activité — 14 derniers jours</h3>
              <p className="text-xs text-muted-foreground">Procès-verbaux créés par jour.</p>
            </div>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarDays className="h-3.5 w-3.5" /> {trendData.length} PV
            </span>
          </div>
          <div className="mt-6 flex h-40 items-end gap-1.5">
            {series14.map((v, i) => {
              const heightPct = (v / max14) * 100;
              const isToday = i === series14.length - 1;
              return (
                <motion.div
                  key={i}
                  initial={{ height: 0 }}
                  animate={{ height: `${Math.max(heightPct, 4)}%` }}
                  transition={{ duration: 0.5, delay: i * 0.03, ease: "easeOut" }}
                  className={`group relative flex-1 rounded-t-md ${
                    isToday ? "bg-primary" : "bg-primary/30 hover:bg-primary/50"
                  } transition-colors`}
                  title={`${v} PV`}
                >
                  <span className="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 rounded-md bg-foreground px-1.5 py-0.5 text-[10px] font-medium text-background opacity-0 transition-opacity group-hover:opacity-100">
                    {v}
                  </span>
                </motion.div>
              );
            })}
          </div>
          <div className="mt-2 flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
            <span>J-14</span>
            <span>Aujourd'hui</span>
          </div>
        </Card>

        {/* Activity feed */}
        <Card className="p-6">
          <div className="flex items-center gap-2">
            <div className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-primary">
              <Activity className="h-3.5 w-3.5" />
            </div>
            <h3 className="font-display font-semibold">Activité récente</h3>
          </div>
          <div className="mt-4 space-y-3">
            {activity.length === 0 && (
              <div className="py-8 text-center">
                <Activity className="mx-auto h-8 w-8 text-muted-foreground/40" />
                <p className="mt-2 text-xs text-muted-foreground">Pas encore d'activité.</p>
              </div>
            )}
            {activity.map((a) => {
              const Icon = a.type === "pv" ? PenLine : a.type === "reserve" ? AlertCircle : Camera;
              return (
                <div key={a.id} className="flex items-start gap-3">
                  <div className="relative mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="flex-1 text-sm">
                    <p className="font-medium leading-tight">{a.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(a.at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {activeCompanyId && <ComplianceWidget companyId={activeCompanyId} />}

      {/* Recent PV + Quick start */}
      <div className="auto-grid-lg">
        <RecentPvCard recent={recent} />


        <Card className="relative overflow-hidden bg-brand-gradient p-6 text-primary-foreground">
          <div className="absolute -right-6 -top-6 h-32 w-32 rounded-full bg-primary-foreground/10 blur-2xl" />
          <div className="absolute inset-0 -z-0 opacity-[0.08]"
            style={{
              backgroundImage:
                "linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)",
              backgroundSize: "32px 32px",
            }}
          />
          <div className="relative">
            <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary-foreground/15">
              <Sparkles className="h-4 w-4" />
            </div>
            <h3 className="mt-4 font-display text-xl font-bold tracking-tight">Prêt à signer ?</h3>
            <p className="mt-2 text-sm text-primary-foreground/85">
              Créez un PV professionnel en moins de 4 minutes avec photos, réserves et signature électronique.
            </p>
            <Link to="/pv/new" search={{ fresh: 1 }} className="mt-5 inline-block">
              <Button variant="secondary" className="text-foreground shadow-lg">
                <Plus className="h-4 w-4" /> Créer mon PV
              </Button>
            </Link>
          </div>
        </Card>
      </div>

      {/* Chantiers */}
      <Card className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-display font-semibold">Derniers chantiers</h3>
            <p className="text-xs text-muted-foreground">Vos interventions en cours.</p>
          </div>
          <Link
            to="/chantiers"
            className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            Tous les chantiers <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>
        <div className="mt-4 auto-grid">
          {chantiers.length === 0 && (
            <div className="col-span-full py-10 text-center">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-warning/10 text-warning">
                <HardHat className="h-5 w-5" />
              </div>
              <p className="mt-3 text-sm font-medium">Aucun chantier</p>
              <p className="text-xs text-muted-foreground">Créez-en un pour démarrer un PV.</p>
            </div>
          )}
          {chantiers.map((c) => (
            <Link
              key={c.id}
              to="/chantiers"
              className="group rounded-xl border border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
            >
              <div className="flex items-center justify-between">
                <div className="grid h-9 w-9 place-items-center rounded-lg bg-warning/10 text-warning">
                  <HardHat className="h-4 w-4" />
                </div>
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {c.status}
                </span>
              </div>
              <p className="mt-3 truncate font-medium">{c.name}</p>
              <p className="truncate text-xs text-muted-foreground">{c.address ?? "Adresse non renseignée"}</p>
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}

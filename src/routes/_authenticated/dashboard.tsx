import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { AnimatedCounter } from "@/components/app/AnimatedCounter";
import { PvStatusPill } from "@/components/ui/status-pill";
import { PageHeader } from "@/components/app/PageHeader";
import { useCompany } from "@/hooks/use-company";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
  head: () => ({ meta: [{ title: "Tableau de bord — PVIA" }] }),
});

type Stats = { pv: number; signed: number; pending: number; openReserves: number };
type Pv = { id: string; numero: string; status: string; created_at: string; reception_date: string | null };
type Ch = { id: string; name: string; status: string; address: string | null; created_at: string };
type Activity = { id: string; type: "pv" | "reserve" | "chantier"; label: string; at: string };

function Dashboard() {
  const { activeCompanyId } = useCompany();
  const [stats, setStats] = useState<Stats>({ pv: 0, signed: 0, pending: 0, openReserves: 0 });
  const [recent, setRecent] = useState<Pv[]>([]);
  const [chantiers, setChantiers] = useState<Ch[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!activeCompanyId) return;
    (async () => {
      setLoaded(false);
      const base = () => supabase.from("pv").select("id", { count: "exact", head: true }).eq("company_id", activeCompanyId);
      const [pv, signed, pending, reserves, rec, chs] = await Promise.all([
        base(),
        base().eq("status", "signe"),
        base().eq("status", "brouillon"),
        supabase.from("pv_reserves").select("id", { count: "exact", head: true }).eq("status", "ouverte").eq("company_id", activeCompanyId),
        supabase.from("pv").select("id,numero,status,created_at,reception_date").eq("company_id", activeCompanyId).order("created_at", { ascending: false }).limit(6),
        supabase.from("chantiers").select("id,name,status,address,created_at").eq("company_id", activeCompanyId).order("created_at", { ascending: false }).limit(4),
      ]);
      setStats({
        pv: pv.count ?? 0,
        signed: signed.count ?? 0,
        pending: pending.count ?? 0,
        openReserves: reserves.count ?? 0,
      });
      setRecent(rec.data ?? []);
      setChantiers(chs.data ?? []);

      const acts: Activity[] = (rec.data ?? []).slice(0, 5).map((p) => ({
        id: p.id,
        type: "pv",
        label: p.status === "signe" ? `PV ${p.numero} signé` : `PV ${p.numero} créé`,
        at: p.created_at,
      }));
      setActivity(acts);
      setLoaded(true);
    })();
  }, [activeCompanyId]);

  const kpis = [
    {
      label: "PV créés",
      value: stats.pv,
      icon: FileText,
      gradient: "from-primary/15 to-primary/5",
      iconColor: "text-primary",
      trend: "+12% ce mois",
    },
    {
      label: "PV signés",
      value: stats.signed,
      icon: CheckCircle2,
      gradient: "from-emerald-500/15 to-emerald-500/5",
      iconColor: "text-emerald-600",
      trend: `${stats.pv ? Math.round((stats.signed / stats.pv) * 100) : 0}% de taux`,
    },
    {
      label: "PV en attente",
      value: stats.pending,
      icon: Clock,
      gradient: "from-amber-500/15 to-amber-500/5",
      iconColor: "text-amber-600",
      trend: "À finaliser",
    },
    {
      label: "Réserves ouvertes",
      value: stats.openReserves,
      icon: AlertCircle,
      gradient: "from-rose-500/15 to-rose-500/5",
      iconColor: "text-rose-600",
      trend: "À traiter",
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
          <Link to="/pv/new">
            <Button size="lg" className="shadow-brand">
              <Plus className="h-4 w-4" /> Créer un nouveau PV
            </Button>
          </Link>
        }
      />

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k, i) => (
          <motion.div
            key={k.label}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: i * 0.06 }}
          >
            <Card className="group relative overflow-hidden p-5 transition-all hover:-translate-y-0.5 hover:shadow-lg">
              <div className={`absolute -right-8 -top-8 h-32 w-32 rounded-full bg-gradient-to-br ${k.gradient} blur-2xl`} />
              <div className="relative">
                <div className="flex items-start justify-between">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {k.label}
                  </p>
                  <div className={`rounded-lg bg-background p-2 ring-1 ring-border ${k.iconColor}`}>
                    <k.icon className="h-4 w-4" />
                  </div>
                </div>
                <p className="mt-3 text-3xl font-bold tracking-tight">
                  {loaded ? <AnimatedCounter value={k.value} /> : 0}
                </p>
                <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <TrendingUp className="h-3 w-3" /> {k.trend}
                </p>
              </div>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Main grid */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Recent PV */}
        <Card className="p-6 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold">Derniers procès-verbaux</h3>
              <p className="text-xs text-muted-foreground">Vos PV les plus récents.</p>
            </div>
            <Link
              to="/pv"
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              Voir tout <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>

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
                    <td colSpan={3} className="px-4 py-10 text-center text-sm text-muted-foreground">
                      <FileText className="mx-auto mb-2 h-8 w-8 opacity-40" />
                      Aucun PV pour le moment.
                      <div className="mt-3">
                        <Link to="/pv/new">
                          <Button size="sm" variant="outline"><Plus className="h-3 w-3" /> Créer le premier</Button>
                        </Link>
                      </div>
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
        </Card>

        {/* Activity feed */}
        <Card className="p-6">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            <h3 className="font-semibold">Activité récente</h3>
          </div>
          <div className="mt-4 space-y-3">
            {activity.length === 0 && (
              <p className="py-6 text-center text-xs text-muted-foreground">
                Pas encore d'activité.
              </p>
            )}
            {activity.map((a) => {
              const Icon = a.type === "pv" ? PenLine : a.type === "reserve" ? AlertCircle : Camera;
              return (
                <div key={a.id} className="flex items-start gap-3">
                  <div className="mt-0.5 grid h-7 w-7 place-items-center rounded-full bg-primary/10 text-primary">
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

      {/* Chantiers + Quick start */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-6 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold">Derniers chantiers</h3>
              <p className="text-xs text-muted-foreground">Vos interventions en cours.</p>
            </div>
            <Link
              to="/chantiers"
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              Tous les chantiers <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {chantiers.length === 0 && (
              <p className="col-span-2 py-6 text-center text-sm text-muted-foreground">
                Aucun chantier — créez-en un pour démarrer.
              </p>
            )}
            {chantiers.map((c) => (
              <div
                key={c.id}
                className="group rounded-xl border border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
              >
                <div className="flex items-center justify-between">
                  <div className="grid h-9 w-9 place-items-center rounded-lg bg-orange-500/10 text-orange-600">
                    <HardHat className="h-4 w-4" />
                  </div>
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    {c.status}
                  </span>
                </div>
                <p className="mt-3 truncate font-medium">{c.name}</p>
                <p className="truncate text-xs text-muted-foreground">{c.address ?? "Adresse non renseignée"}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card className="relative overflow-hidden bg-gradient-to-br from-primary to-primary/80 p-6 text-primary-foreground">
          <div className="absolute -right-6 -top-6 h-32 w-32 rounded-full bg-white/10 blur-2xl" />
          <Sparkles className="h-6 w-6" />
          <h3 className="mt-3 text-lg font-semibold">Prêt à signer ?</h3>
          <p className="mt-1 text-sm text-primary-foreground/80">
            Créez un PV professionnel en moins de 4 minutes avec photos, réserves et signature électronique.
          </p>
          <Link to="/pv/new" className="mt-5 inline-block">
            <Button variant="secondary" className="text-foreground">
              <Plus className="h-4 w-4" /> Créer mon PV
            </Button>
          </Link>
        </Card>
      </div>
    </div>
  );
}

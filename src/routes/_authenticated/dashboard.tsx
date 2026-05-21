import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { FileText, HardHat, Users, CheckCircle2, Plus, ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
  head: () => ({ meta: [{ title: "Tableau de bord — PV Pro" }] }),
});

type Stats = { pv: number; signed: number; chantiers: number; clients: number };

function Dashboard() {
  const [stats, setStats] = useState<Stats>({ pv: 0, signed: 0, chantiers: 0, clients: 0 });
  const [recent, setRecent] = useState<{ id: string; numero: string; status: string; created_at: string }[]>([]);

  useEffect(() => {
    (async () => {
      const [pv, signed, ch, cl, rec] = await Promise.all([
        supabase.from("pv").select("id", { count: "exact", head: true }),
        supabase.from("pv").select("id", { count: "exact", head: true }).eq("status", "signe"),
        supabase.from("chantiers").select("id", { count: "exact", head: true }),
        supabase.from("clients").select("id", { count: "exact", head: true }),
        supabase.from("pv").select("id,numero,status,created_at").order("created_at", { ascending: false }).limit(5),
      ]);
      setStats({ pv: pv.count ?? 0, signed: signed.count ?? 0, chantiers: ch.count ?? 0, clients: cl.count ?? 0 });
      setRecent(rec.data ?? []);
    })();
  }, []);

  const kpis = [
    { label: "PV créés", value: stats.pv, icon: FileText, accent: "text-primary" },
    { label: "PV signés", value: stats.signed, icon: CheckCircle2, accent: "text-emerald-600" },
    { label: "Chantiers", value: stats.chantiers, icon: HardHat, accent: "text-orange-600" },
    { label: "Clients", value: stats.clients, icon: Users, accent: "text-violet-600" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tableau de bord</h1>
          <p className="text-sm text-muted-foreground">Vue d'ensemble de votre activité.</p>
        </div>
        <Link to="/pv/new">
          <Button><Plus className="h-4 w-4" /> Créer un PV</Button>
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label} className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{k.label}</p>
                <p className="mt-2 text-3xl font-semibold tracking-tight">{k.value}</p>
              </div>
              <div className={`rounded-lg bg-muted p-2 ${k.accent}`}>
                <k.icon className="h-5 w-5" />
              </div>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2 p-6">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Derniers procès-verbaux</h3>
            <Link to="/pv" className="text-sm text-primary hover:underline inline-flex items-center gap-1">
              Voir tout <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="mt-4 divide-y divide-border">
            {recent.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Aucun PV pour le moment.</p>}
            {recent.map((r) => (
              <div key={r.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="text-sm font-medium">{r.numero}</p>
                  <p className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString("fr-FR")}</p>
                </div>
                <Badge variant={r.status === "signe" ? "default" : "secondary"}>{r.status}</Badge>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-6">
          <h3 className="font-semibold">Démarrage rapide</h3>
          <div className="mt-4 space-y-3">
            <Link to="/clients" className="block rounded-lg border border-border p-3 hover:border-primary"><p className="text-sm font-medium">1. Ajoutez un client</p><p className="text-xs text-muted-foreground">Centralisez vos contacts.</p></Link>
            <Link to="/chantiers" className="block rounded-lg border border-border p-3 hover:border-primary"><p className="text-sm font-medium">2. Créez un chantier</p><p className="text-xs text-muted-foreground">Liez vos interventions.</p></Link>
            <Link to="/pv/new" className="block rounded-lg border border-border p-3 hover:border-primary"><p className="text-sm font-medium">3. Établissez un PV</p><p className="text-xs text-muted-foreground">Photos, réserves, signature.</p></Link>
          </div>
        </Card>
      </div>
    </div>
  );
}

import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getPlatformStats } from "@/lib/admin-platform.functions";

import { Card } from "@/components/ui/card";
import { Loader2, Building2, Users, FileText, Mail, AlertTriangle, CreditCard, Webhook, ShieldAlert, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/dashboard")({
  component: Page,
  head: () => ({ meta: [{ title: "Admin · Dashboard — PVIA" }] }),
  beforeLoad: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw redirect({ to: "/login" });
    const { isPlatformAdminEmail } = await import("@/lib/platform-admin");
    if (!isPlatformAdminEmail(user.email)) throw redirect({ to: "/admin/forbidden" });
    const { data } = await supabase.from("user_roles").select("role").eq("user_id", user.id).eq("role", "platform_admin").maybeSingle();
    if (!data) throw redirect({ to: "/admin/forbidden" });
  },
});

function Kpi({ icon: Icon, label, value, sub }: any) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="mt-2 text-2xl font-bold">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </Card>
  );
}

function Page() {
  const fn = useServerFn(getPlatformStats);
  const [data, setData] = useState<any>(null);
  useEffect(() => { fn().then(setData).catch(console.error); }, [fn]);

  if (!data) return (
    <div><div className="grid place-items-center py-20"><Loader2 className="h-6 w-6 animate-spin" /></div></div>
  );

  return (
    <div>
      
      <h1 className="mb-1 text-2xl font-bold">Cockpit plateforme PVIA</h1>
      <p className="mb-4 text-sm text-muted-foreground">Vue d'ensemble de toutes les entreprises et de l'activité globale.</p>
      <div className="mb-6 flex flex-wrap gap-2">
        <Link to="/admin/compliance" className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent"><ShieldCheck className="h-3.5 w-3.5"/> Conformité CNIL</Link>
        <Link to="/admin/emails" className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent"><Mail className="h-3.5 w-3.5"/> Catalogue emails</Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi icon={Building2} label="Entreprises" value={data.companies.total} sub={`${data.companies.onboarded} onboardées`} />
        <Kpi icon={Users} label="Utilisateurs" value={data.users.total} />
        <Kpi icon={FileText} label="PV totaux" value={data.pv.total} sub={`${data.pv.month} ce mois · ${data.pv.signed} signés`} />
        <Kpi icon={CreditCard} label="Abonnements payants" value={data.subscriptions.paying} sub={`${data.subscriptions.trialing} essais · ${data.subscriptions.pastDue} past_due`} />
        <Kpi icon={Mail} label="Emails ce mois" value={data.emails.month} />
        <Kpi icon={Webhook} label="Webhooks échoués" value={data.webhooks.failed} />
        <Kpi icon={ShieldAlert} label="Erreurs critiques" value={data.errors.criticalOpen} sub="non résolues" />
        <Kpi icon={AlertTriangle} label="Past_due" value={data.subscriptions.pastDue} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Dernières entreprises inscrites</h2>
            <Link to="/admin/companies" className="text-xs text-primary hover:underline">Voir toutes →</Link>
          </div>
          <ul className="divide-y text-sm">
            {data.recentCompanies.map((c: any) => (
              <li key={c.id} className="flex items-center justify-between py-2">
                <Link to="/admin/companies/$id" params={{ id: c.id }} className="font-medium hover:underline">{c.name}</Link>
                <span className="text-xs text-muted-foreground">{new Date(c.created_at).toLocaleDateString("fr-FR")}</span>
              </li>
            ))}
            {data.recentCompanies.length === 0 && <li className="py-2 text-xs text-muted-foreground">Aucune entreprise.</li>}
          </ul>
        </Card>

        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Erreurs récentes non résolues</h2>
            <Link to="/admin/monitoring" className="text-xs text-primary hover:underline">Monitoring →</Link>
          </div>
          <ul className="divide-y text-sm">
            {data.recentErrors.map((e: any) => (
              <li key={e.id} className="py-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-destructive">{e.severity}</span>
                  <span className="text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString("fr-FR")}</span>
                </div>
                <div className="text-xs text-muted-foreground">{e.source} · {e.message?.slice(0, 100)}</div>
              </li>
            ))}
            {data.recentErrors.length === 0 && <li className="py-2 text-xs text-muted-foreground">Aucune erreur ouverte.</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}

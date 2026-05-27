import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getAdminBillingOverview, adminResyncStripeSubscription } from "@/lib/admin-platform.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/billing")({
  component: Page,
  head: () => ({ meta: [{ title: "Admin · Facturation — PVIA" }] }),
  beforeLoad: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw redirect({ to: "/login" });
    const { isPlatformAdminEmail } = await import("@/lib/platform-admin");
    if (!isPlatformAdminEmail(user.email)) throw redirect({ to: "/admin/forbidden" });
    const { data } = await supabase.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!data) throw redirect({ to: "/admin/forbidden" });
  },
});

function Kpi({ label, value, sub }: any) {
  return (
    <Card className="bg-zinc-900 border-zinc-800 p-4">
      <div className="text-xs uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-zinc-100">{value}</div>
      {sub && <div className="text-xs text-zinc-500">{sub}</div>}
    </Card>
  );
}

function Bucket({ title, rows, onResync, busy }: any) {
  return (
    <Card className="bg-zinc-900 border-zinc-800 p-4">
      <h3 className="mb-2 text-sm font-semibold text-zinc-100">{title} ({rows.length})</h3>
      <ul className="divide-y divide-zinc-800 text-sm text-zinc-300 max-h-80 overflow-y-auto">
        {rows.map((s: any) => (
          <li key={s.id} className="flex items-center justify-between py-1.5">
            <Link to="/admin/companies/$id" params={{ id: s.company_id }} className="hover:underline">
              {s.company?.name ?? s.company_id}
            </Link>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{s.plan}</Badge>
              <span className="text-xs text-zinc-500">{s.monthly_price_eur}€/mois</span>
              <Button size="sm" variant="outline" disabled={busy}
                onClick={() => onResync(s.company_id)}>Resync</Button>
            </div>
          </li>
        ))}
        {rows.length === 0 && <li className="py-2 text-xs text-zinc-500">Aucun.</li>}
      </ul>
    </Card>
  );
}

function Page() {
  const fn = useServerFn(getAdminBillingOverview);
  const resyncFn = useServerFn(adminResyncStripeSubscription);
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { fn().then(setData).catch((e) => toast.error(e.message)); }, [fn]);

  async function onResync(companyId: string) {
    setBusy(true);
    try { await resyncFn({ data: { companyId } }); toast.success("Resync demandé"); }
    catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  if (!data) return <div className="grid place-items-center py-20"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-zinc-100">Facturation plateforme</h1>
      <p className="mb-6 text-sm text-zinc-400">MRR, abonnements et suivi paiements.</p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="MRR estimé" value={`${data.mrrEstimateEur} €`} sub="active + past_due" />
        <Kpi label="Actifs" value={data.counts.active} />
        <Kpi label="Essais" value={data.counts.trialing} />
        <Kpi label="Past due" value={data.counts.past_due} />
        <Kpi label="Canceled" value={data.counts.canceled} />
        <Kpi label="Sans abonnement" value={data.counts.no_sub} sub={`sur ${data.counts.total_companies}`} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Bucket title="Paiements en échec" rows={data.buckets.past_due} onResync={onResync} busy={busy} />
        <Bucket title="Essais en cours" rows={data.buckets.trialing} onResync={onResync} busy={busy} />
        <Bucket title="Actifs" rows={data.buckets.active} onResync={onResync} busy={busy} />
        <Bucket title="Annulés" rows={data.buckets.canceled} onResync={onResync} busy={busy} />
        <Card className="bg-zinc-900 border-zinc-800 p-4 lg:col-span-2">
          <h3 className="mb-2 text-sm font-semibold text-zinc-100">Entreprises sans abonnement ({data.noSub.length})</h3>
          <ul className="divide-y divide-zinc-800 text-sm text-zinc-300 max-h-80 overflow-y-auto">
            {data.noSub.map((c: any) => (
              <li key={c.id} className="flex justify-between py-1.5">
                <Link to="/admin/companies/$id" params={{ id: c.id }} className="hover:underline">{c.name}</Link>
                <span className="text-xs text-zinc-500">{c.email}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

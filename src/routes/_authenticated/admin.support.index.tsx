import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { listAdminSupportIssues, adminRetryFailedWebhook } from "@/lib/admin-platform.functions";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/support/")({
  component: Page,
  head: () => ({ meta: [{ title: "Admin · Support — PVIA" }] }),
});

function Page() {
  const fn = useServerFn(listAdminSupportIssues);
  const retryFn = useServerFn(adminRetryFailedWebhook);
  const [d, setD] = useState<any>(null);

  const load = () => fn().then(setD);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  if (!d) return <div className="grid place-items-center py-20"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  async function retry(id: string) {
    try { await retryFn({ data: { deliveryId: id } }); toast.success("Webhook replanifié"); await load(); }
    catch (e: any) { toast.error(e.message); }
  }

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold">Support — entreprises en difficulté</h1>
      <p className="mb-6 text-sm text-muted-foreground">Dernière semaine. Cliquez sur une entreprise pour ouvrir le centre support dédié.</p>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold">Onboarding bloqué ({d.stuckOnboarding.length})</h2>
          <ul className="divide-y text-sm">
            {d.stuckOnboarding.map((c: any) => (
              <li key={c.id} className="flex justify-between py-1.5">
                <Link to="/admin/support/$companyId" params={{ companyId: c.id }} className="hover:underline">{c.name}</Link>
                <span className="text-xs text-muted-foreground">{c.email}</span>
              </li>
            ))}
            {d.stuckOnboarding.length === 0 && <li className="py-1.5 text-xs text-muted-foreground">Aucune.</li>}
          </ul>
        </Card>

        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold">Paiements past_due ({d.pastDue.length})</h2>
          <ul className="divide-y text-sm">
            {d.pastDue.map((s: any, i: number) => (
              <li key={i} className="flex justify-between py-1.5">
                <Link to="/admin/support/$companyId" params={{ companyId: s.company_id }} className="hover:underline font-mono text-xs">{s.company_id.slice(0, 8)}…</Link>
                <span className="text-xs"><Badge>{s.plan}</Badge></span>
              </li>
            ))}
            {d.pastDue.length === 0 && <li className="py-1.5 text-xs text-muted-foreground">Aucun.</li>}
          </ul>
        </Card>

        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold">Emails échoués ({d.emailFailures.length})</h2>
          <ul className="divide-y text-sm">
            {d.emailFailures.map((e: any) => (
              <li key={e.id} className="py-1.5">
                <div className="flex justify-between">
                  <span>{e.email_type} → {e.recipient_email}</span>
                  {e.company_id && <Link to="/admin/support/$companyId" params={{ companyId: e.company_id }} className="text-xs hover:underline">Fiche →</Link>}
                </div>
                {e.error_message && <div className="text-xs text-destructive">{e.error_message.slice(0, 140)}</div>}
              </li>
            ))}
            {d.emailFailures.length === 0 && <li className="py-1.5 text-xs text-muted-foreground">Aucun.</li>}
          </ul>
        </Card>

        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold">Webhooks échoués ({d.webhookFailures.length})</h2>
          <ul className="divide-y text-sm">
            {d.webhookFailures.map((w: any) => (
              <li key={w.id} className="flex items-center justify-between py-1.5">
                <span className="truncate">{w.event} <span className="text-xs text-muted-foreground">({w.response_code ?? "—"})</span></span>
                <div className="flex gap-1">
                  {w.company_id && <Link to="/admin/support/$companyId" params={{ companyId: w.company_id }} className="text-xs underline self-center">Fiche</Link>}
                  <Button size="sm" variant="outline" onClick={() => retry(w.id)}>Relancer</Button>
                </div>
              </li>
            ))}
            {d.webhookFailures.length === 0 && <li className="py-1.5 text-xs text-muted-foreground">Aucun.</li>}
          </ul>
        </Card>

        <Card className="p-4 lg:col-span-2">
          <h2 className="mb-2 text-sm font-semibold">Erreurs récentes ({d.errors.length})</h2>
          <ul className="divide-y text-sm">
            {d.errors.map((e: any) => (
              <li key={e.id} className="py-1.5">
                <div className="flex justify-between">
                  <span><Badge variant={e.severity === "critical" ? "destructive" : "outline"}>{e.severity}</Badge> {e.source}</span>
                  <span className="text-xs text-muted-foreground">
                    {e.company_id && <Link to="/admin/support/$companyId" params={{ companyId: e.company_id }} className="mr-2 hover:underline">Fiche →</Link>}
                    {new Date(e.created_at).toLocaleString("fr-FR")}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">{e.message?.slice(0, 200)}</div>
              </li>
            ))}
            {d.errors.length === 0 && <li className="py-1.5 text-xs text-muted-foreground">Aucune.</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}

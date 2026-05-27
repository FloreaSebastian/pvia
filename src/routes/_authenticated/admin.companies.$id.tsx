import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  getAdminCompanyDetail, adminSuspendCompany, adminReactivateCompany,
  adminResetCompanyOnboarding, adminAddSupportNote,
} from "@/lib/admin-platform.functions";
import { AdminNav } from "@/components/admin/AdminNav";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/companies/$id")({
  component: Page,
  head: () => ({ meta: [{ title: "Admin · Entreprise — PVIA" }] }),
  beforeLoad: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw redirect({ to: "/login" });
    const { data } = await supabase.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!data) throw redirect({ to: "/dashboard" });
  },
});

function Section({ title, children }: any) {
  return (
    <Card className="p-4">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {children}
    </Card>
  );
}

function Page() {
  const { id } = Route.useParams();
  const getFn = useServerFn(getAdminCompanyDetail);
  const suspendFn = useServerFn(adminSuspendCompany);
  const reactivateFn = useServerFn(adminReactivateCompany);
  const resetFn = useServerFn(adminResetCompanyOnboarding);
  const noteFn = useServerFn(adminAddSupportNote);

  const [d, setD] = useState<any>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => getFn({ data: { id } }).then(setD).catch((e) => toast.error(e.message));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  if (!d) return <div><AdminNav /><div className="grid place-items-center py-20"><Loader2 className="h-6 w-6 animate-spin" /></div></div>;

  async function action(fn: () => Promise<any>, msg: string) {
    setBusy(true);
    try { await fn(); toast.success(msg); await load(); }
    catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  const c = d.company;
  return (
    <div>
      <AdminNav />
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{c.name}</h1>
          <p className="text-sm text-muted-foreground">{c.email ?? "—"} · {c.siret ?? c.siren ?? "—"}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={busy}
            onClick={() => action(() => resetFn({ data: { companyId: id } }), "Onboarding réinitialisé")}>
            Réinitialiser onboarding
          </Button>
          <Button size="sm" variant="outline" disabled={busy}
            onClick={() => action(() => reactivateFn({ data: { companyId: id } }), "Entreprise réactivée")}>
            Réactiver
          </Button>
          <Button size="sm" variant="destructive" disabled={busy}
            onClick={() => action(() => suspendFn({ data: { companyId: id } }), "Entreprise suspendue")}>
            Suspendre
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Infos entreprise">
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-muted-foreground">Adresse</dt><dd>{c.address ?? "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Téléphone</dt><dd>{c.phone ?? "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Onboarding</dt><dd>{c.onboarding_completed_at ? "Complété" : <Badge variant="destructive">Incomplet</Badge>}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Créée le</dt><dd>{new Date(c.created_at).toLocaleString("fr-FR")}</dd></div>
          </dl>
        </Section>

        <Section title="Abonnement">
          {d.subscription ? (
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between"><dt>Plan</dt><dd><Badge>{d.subscription.plan}</Badge></dd></div>
              <div className="flex justify-between"><dt>Statut</dt><dd><Badge>{d.subscription.status}</Badge></dd></div>
              <div className="flex justify-between"><dt>Période</dt><dd className="text-xs">{d.subscription.current_period_end ? new Date(d.subscription.current_period_end).toLocaleDateString("fr-FR") : "—"}</dd></div>
              <div className="flex justify-between"><dt>Trial fin</dt><dd className="text-xs">{d.subscription.trial_end ? new Date(d.subscription.trial_end).toLocaleDateString("fr-FR") : "—"}</dd></div>
            </dl>
          ) : <p className="text-xs text-muted-foreground">Aucun abonnement enregistré (plan starter par défaut).</p>}
        </Section>

        <Section title={`Membres (${d.members.length})`}>
          <ul className="divide-y text-sm">
            {d.members.map((m: any) => (
              <li key={m.id} className="flex items-center justify-between py-1.5">
                <span>{m.invited_email ?? m.user_id}</span>
                <span className="text-xs text-muted-foreground">{m.role} · {m.status}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title={`Derniers PV (${d.pvs.length})`}>
          <ul className="divide-y text-sm">
            {d.pvs.map((p: any) => (
              <li key={p.id} className="flex items-center justify-between py-1.5">
                <span>{p.numero}</span>
                <span className="text-xs text-muted-foreground">{p.status} · {new Date(p.created_at).toLocaleDateString("fr-FR")}</span>
              </li>
            ))}
            {d.pvs.length === 0 && <li className="py-1.5 text-xs text-muted-foreground">Aucun PV.</li>}
          </ul>
        </Section>

        <Section title={`Erreurs (${d.errors.length})`}>
          <ul className="divide-y text-sm">
            {d.errors.map((e: any) => (
              <li key={e.id} className="py-1.5">
                <div className="flex justify-between"><span className="font-medium">{e.severity}</span><span className="text-xs text-muted-foreground">{new Date(e.created_at).toLocaleDateString("fr-FR")}</span></div>
                <div className="text-xs text-muted-foreground">{e.source}: {e.message?.slice(0, 120)}</div>
              </li>
            ))}
            {d.errors.length === 0 && <li className="py-1.5 text-xs text-muted-foreground">Aucune erreur.</li>}
          </ul>
        </Section>

        <Section title={`Emails (${d.emails.length}) / Webhooks (${d.webhooks.length})`}>
          <div className="space-y-2 text-xs">
            <ul className="divide-y">
              {d.emails.slice(0, 5).map((e: any) => (
                <li key={e.id} className="flex justify-between py-1"><span>{e.email_type} → {e.recipient_email}</span><Badge variant={e.status === "failed" ? "destructive" : "outline"}>{e.status}</Badge></li>
              ))}
            </ul>
            <ul className="divide-y">
              {d.webhooks.slice(0, 5).map((w: any) => (
                <li key={w.id} className="flex justify-between py-1"><span>{w.event}</span><Badge variant={w.status === "failed" ? "destructive" : "outline"}>{w.status} {w.response_code ?? ""}</Badge></li>
              ))}
            </ul>
          </div>
        </Section>

        <Section title="Note support">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note d'intervention admin…" rows={3} />
          <Button size="sm" className="mt-2" disabled={busy || !note.trim()}
            onClick={() => action(async () => { await noteFn({ data: { companyId: id, note } }); setNote(""); }, "Note enregistrée")}>
            Enregistrer la note
          </Button>
        </Section>

        <Section title={`Audit logs (${d.audits.length})`}>
          <ul className="divide-y text-xs">
            {d.audits.map((a: any) => (
              <li key={a.id} className="flex justify-between py-1">
                <span className="font-mono">{a.action}</span>
                <span className="text-muted-foreground">{new Date(a.created_at).toLocaleString("fr-FR")}</span>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </div>
  );
}

import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  getAdminCompanyDetail, adminSuspendCompany, adminReactivateCompany,
  adminResetCompanyOnboarding, adminAddSupportNote, adminListSupportNotes,
  adminDeleteSupportNote, adminSetSupportStatus, adminResyncStripeSubscription,
  adminResendInvite, adminStartImpersonation, adminEndImpersonation,
  adminRetryFailedWebhook, adminRetryFailedEmail,
} from "@/lib/admin-platform.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Loader2, AlertOctagon, Eye, Trash2 } from "lucide-react";
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

function Section({ title, children, actions }: any) {
  return (
    <Card className="bg-zinc-900 border-zinc-800 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
        {actions}
      </div>
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
  const listNotesFn = useServerFn(adminListSupportNotes);
  const delNoteFn = useServerFn(adminDeleteSupportNote);
  const setStatusFn = useServerFn(adminSetSupportStatus);
  const resyncFn = useServerFn(adminResyncStripeSubscription);
  const resendInviteFn = useServerFn(adminResendInvite);
  const startImpFn = useServerFn(adminStartImpersonation);
  const endImpFn = useServerFn(adminEndImpersonation);
  const retryHookFn = useServerFn(adminRetryFailedWebhook);
  const retryMailFn = useServerFn(adminRetryFailedEmail);

  const [d, setD] = useState<any>(null);
  const [notes, setNotes] = useState<any[]>([]);
  const [note, setNote] = useState("");
  const [visibility, setVisibility] = useState<"internal" | "customer_visible">("internal");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [imp, setImp] = useState<{ sessionId: string; expiresAt: string } | null>(null);

  const load = async () => {
    try {
      const det = await getFn({ data: { id } });
      setD(det);
      const n = await listNotesFn({ data: { companyId: id } });
      setNotes(n.notes);
    } catch (e: any) { toast.error(e.message); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  if (!d) return <div className="grid place-items-center py-20"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  async function run(fn: () => Promise<any>, msg: string) {
    setBusy(true);
    try { await fn(); toast.success(msg); await load(); }
    catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  const c = d.company;
  const suspended = !!c.suspended_at || c.support_status === "blocked";

  return (
    <div className="space-y-4">
      {imp && (
        <div className="flex items-center justify-between rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200">
          <span className="flex items-center gap-2">
            <Eye className="h-4 w-4" /> Mode support actif (lecture seule) · expire à {new Date(imp.expiresAt).toLocaleTimeString("fr-FR")}
          </span>
          <Button size="sm" variant="outline"
            onClick={() => run(async () => { await endImpFn({ data: { sessionId: imp.sessionId } }); setImp(null); }, "Mode support terminé")}>
            Terminer
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-zinc-100">{c.name}</h1>
            {suspended && <Badge variant="destructive" className="gap-1"><AlertOctagon className="h-3 w-3" /> Suspendue</Badge>}
            {c.support_status === "watched" && <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/40">À surveiller</Badge>}
          </div>
          <p className="text-sm text-zinc-400">{c.email ?? "—"} · {c.siret ?? c.siren ?? "—"}</p>
          {c.suspension_reason && <p className="text-xs text-red-300 mt-1">Raison: {c.suspension_reason}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={busy}
            onClick={() => run(() => setStatusFn({ data: { companyId: id, status: "watched" } }), "Marquée à surveiller")}>
            À surveiller
          </Button>
          <Button size="sm" variant="outline" disabled={busy}
            onClick={() => run(() => resyncFn({ data: { companyId: id } }), "Resync Stripe demandé")}>
            Resync Stripe
          </Button>
          <Button size="sm" variant="outline" disabled={busy}
            onClick={() => run(() => resetFn({ data: { companyId: id } }), "Onboarding réinitialisé")}>
            Reset onboarding
          </Button>
          {suspended ? (
            <Button size="sm" disabled={busy}
              onClick={() => run(() => reactivateFn({ data: { companyId: id } }), "Entreprise réactivée")}>
              Réactiver
            </Button>
          ) : (
            <Button size="sm" variant="destructive" disabled={busy || !reason.trim()}
              onClick={() => run(() => suspendFn({ data: { companyId: id, reason } }), "Entreprise suspendue")}>
              Suspendre
            </Button>
          )}
        </div>
      </div>

      {!suspended && (
        <Input value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder="Raison de suspension (requis pour suspendre)"
          className="max-w-xl bg-zinc-900 border-zinc-700 text-zinc-100" />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Infos entreprise">
          <dl className="space-y-1 text-sm text-zinc-300">
            <div className="flex justify-between"><dt className="text-zinc-500">Adresse</dt><dd>{c.address ?? "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-zinc-500">Téléphone</dt><dd>{c.phone ?? "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-zinc-500">Onboarding</dt><dd>{c.onboarding_completed_at ? "Complété" : <Badge variant="destructive">Incomplet</Badge>}</dd></div>
            <div className="flex justify-between"><dt className="text-zinc-500">Support</dt><dd><Badge>{c.support_status ?? "active"}</Badge></dd></div>
            <div className="flex justify-between"><dt className="text-zinc-500">Créée le</dt><dd>{new Date(c.created_at).toLocaleString("fr-FR")}</dd></div>
          </dl>
        </Section>

        <Section title="Abonnement">
          {d.subscription ? (
            <dl className="space-y-1 text-sm text-zinc-300">
              <div className="flex justify-between"><dt>Plan</dt><dd><Badge>{d.subscription.plan}</Badge></dd></div>
              <div className="flex justify-between"><dt>Statut</dt><dd><Badge>{d.subscription.status}</Badge></dd></div>
              <div className="flex justify-between"><dt>Période fin</dt><dd className="text-xs">{d.subscription.current_period_end ? new Date(d.subscription.current_period_end).toLocaleDateString("fr-FR") : "—"}</dd></div>
            </dl>
          ) : <p className="text-xs text-zinc-500">Aucun abonnement (starter par défaut).</p>}
        </Section>

        <Section title="Support — Mode lecture (impersonation)">
          <p className="mb-2 text-xs text-zinc-500">Sécurisé : audit, lecture seule, 30 min max. Ne donne pas accès aux mutations.</p>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motif (obligatoire)"
            className="mb-2 bg-zinc-900 border-zinc-700 text-zinc-100" />
          <Button size="sm" disabled={busy || !!imp || reason.trim().length < 3}
            onClick={() => run(async () => {
              const r = await startImpFn({ data: { companyId: id, reason } });
              setImp(r);
            }, "Mode support démarré")}>
            Démarrer le mode support
          </Button>
        </Section>

        <Section title={`Notes support (${notes.length})`}>
          <div className="space-y-2 mb-3 max-h-48 overflow-y-auto">
            {notes.map((n) => (
              <div key={n.id} className="rounded border border-zinc-800 bg-zinc-950 p-2 text-xs text-zinc-300">
                <div className="flex justify-between mb-1">
                  <Badge variant="outline" className="text-[10px]">{n.visibility}</Badge>
                  <div className="flex items-center gap-2 text-zinc-500">
                    <span>{new Date(n.created_at).toLocaleString("fr-FR")}</span>
                    <button onClick={() => run(() => delNoteFn({ data: { id: n.id, companyId: id } }), "Note supprimée")} disabled={busy}>
                      <Trash2 className="h-3 w-3 text-red-400" />
                    </button>
                  </div>
                </div>
                <div className="whitespace-pre-wrap">{n.note}</div>
              </div>
            ))}
            {notes.length === 0 && <div className="text-xs text-zinc-500">Aucune note.</div>}
          </div>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3}
            placeholder="Nouvelle note…" className="bg-zinc-900 border-zinc-700 text-zinc-100" />
          <div className="mt-2 flex items-center gap-2">
            <select value={visibility} onChange={(e) => setVisibility(e.target.value as any)}
              className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100">
              <option value="internal">Interne</option>
              <option value="customer_visible">Visible client</option>
            </select>
            <Button size="sm" disabled={busy || !note.trim()}
              onClick={() => run(async () => { await noteFn({ data: { companyId: id, note, visibility } }); setNote(""); }, "Note enregistrée")}>
              Enregistrer
            </Button>
          </div>
        </Section>

        <Section title={`Membres (${d.members.length})`}>
          <ul className="divide-y divide-zinc-800 text-sm text-zinc-300">
            {d.members.map((m: any) => (
              <li key={m.id} className="flex items-center justify-between py-1.5">
                <span className="truncate">{m.invited_email ?? m.user_id}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-500">{m.role} · {m.status}</span>
                  {m.status === "invited" && (
                    <Button size="sm" variant="outline" disabled={busy}
                      onClick={() => run(() => resendInviteFn({ data: { memberId: m.id } }), "Invitation relancée")}>
                      Relancer
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Section>

        <Section title={`Webhooks récents (${d.webhooks.length})`}>
          <ul className="divide-y divide-zinc-800 text-xs text-zinc-300">
            {d.webhooks.map((w: any) => (
              <li key={w.id} className="flex justify-between py-1.5">
                <span>{w.event}</span>
                <div className="flex items-center gap-2">
                  <Badge variant={w.status === "failed" ? "destructive" : "outline"}>{w.status} {w.response_code ?? ""}</Badge>
                  {w.status === "failed" && (
                    <Button size="sm" variant="outline" disabled={busy}
                      onClick={() => run(() => retryHookFn({ data: { deliveryId: w.id } }), "Webhook relancé")}>
                      Retry
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Section>

        <Section title={`Emails récents (${d.emails.length})`}>
          <ul className="divide-y divide-zinc-800 text-xs text-zinc-300">
            {d.emails.map((e: any) => (
              <li key={e.id} className="flex justify-between py-1.5">
                <span className="truncate">{e.email_type} → {e.recipient_email}</span>
                <div className="flex items-center gap-2">
                  <Badge variant={e.status === "failed" ? "destructive" : "outline"}>{e.status}</Badge>
                  {e.status === "failed" && (
                    <Button size="sm" variant="outline" disabled={busy}
                      onClick={() => run(() => retryMailFn({ data: { emailLogId: e.id } }), "Email relancé")}>
                      Retry
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Section>

        <Section title={`Derniers PV (${d.pvs.length})`}>
          <ul className="divide-y divide-zinc-800 text-sm text-zinc-300">
            {d.pvs.map((p: any) => (
              <li key={p.id} className="flex items-center justify-between py-1.5">
                <span>{p.numero}</span>
                <span className="text-xs text-zinc-500">{p.status} · {new Date(p.created_at).toLocaleDateString("fr-FR")}</span>
              </li>
            ))}
            {d.pvs.length === 0 && <li className="py-1.5 text-xs text-zinc-500">Aucun PV.</li>}
          </ul>
        </Section>

        <Section title={`Audit logs (${d.audits.length})`}>
          <ul className="divide-y divide-zinc-800 text-xs text-zinc-300 max-h-64 overflow-y-auto">
            {d.audits.map((a: any) => (
              <li key={a.id} className="flex justify-between py-1">
                <span className="font-mono">{a.action}</span>
                <span className="text-zinc-500">{new Date(a.created_at).toLocaleString("fr-FR")}</span>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </div>
  );
}

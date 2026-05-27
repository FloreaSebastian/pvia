import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  getCompanySupportDashboard,
  getCompanySupportTimeline,
  adminClearErrorNotifications,
  adminMarkErrorResolved,
  adminMarkCompanyViewed,
  adminAddSupportNoteV2,
  adminListSupportNotesV2,
  adminResolveSupportNote,
} from "@/lib/admin-support.functions";
import {
  adminSuspendCompany, adminReactivateCompany, adminResetCompanyOnboarding,
  adminResyncStripeSubscription, adminResendInvite, adminStartImpersonation,
} from "@/lib/admin-platform.functions";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertTriangle, Loader2, RefreshCw, ShieldOff, ShieldCheck, Eye, RotateCcw,
  ArrowLeft, FileText, Mail, Webhook, Bug, Bell, CheckCircle2, CircleAlert,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/support/$companyId")({
  component: Page,
  head: () => ({ meta: [{ title: "Admin · Support entreprise — PVIA" }] }),
});

function MiniBar({ data, color }: { data: { date: string; value: number }[]; color: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="flex h-10 items-end gap-0.5">
      {data.map((d, i) => (
        <div key={i} className="flex-1 rounded-sm" style={{ height: `${(d.value / max) * 100}%`, minHeight: 2, background: color }} title={`${d.date} · ${d.value}`} />
      ))}
    </div>
  );
}

function HealthRing({ score, level }: { score: number; level: string }) {
  const color = level === "healthy" ? "#16a34a" : level === "warning" ? "#f59e0b" : "#dc2626";
  const dash = (score / 100) * 251.2;
  return (
    <div className="relative h-24 w-24">
      <svg viewBox="0 0 100 100" className="h-24 w-24 -rotate-90">
        <circle cx="50" cy="50" r="40" stroke="hsl(var(--muted))" strokeWidth="10" fill="none" />
        <circle cx="50" cy="50" r="40" stroke={color} strokeWidth="10" fill="none" strokeDasharray={`${dash} 251.2`} strokeLinecap="round" />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center">
          <div className="text-2xl font-bold" style={{ color }}>{score}</div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{level}</div>
        </div>
      </div>
    </div>
  );
}

function Page() {
  const { companyId } = Route.useParams();

  const loadDash = useServerFn(getCompanySupportDashboard);
  const loadTl = useServerFn(getCompanySupportTimeline);
  const loadNotes = useServerFn(adminListSupportNotesV2);
  const addNote = useServerFn(adminAddSupportNoteV2);
  const resolveNote = useServerFn(adminResolveSupportNote);
  const markErr = useServerFn(adminMarkErrorResolved);
  const clearNotifs = useServerFn(adminClearErrorNotifications);
  const markViewed = useServerFn(adminMarkCompanyViewed);
  const suspend = useServerFn(adminSuspendCompany);
  const reactivate = useServerFn(adminReactivateCompany);
  const resetOnb = useServerFn(adminResetCompanyOnboarding);
  const resync = useServerFn(adminResyncStripeSubscription);
  const resendInv = useServerFn(adminResendInvite);
  const startImp = useServerFn(adminStartImpersonation);

  const [dash, setDash] = useState<any>(null);
  const [tl, setTl] = useState<any[]>([]);
  const [notes, setNotes] = useState<any[]>([]);
  const [tlSearch, setTlSearch] = useState("");
  const [tlTypes, setTlTypes] = useState<Record<string, boolean>>({
    audit: true, email: true, webhook: true, error: true, notification: true,
  });
  const [newNote, setNewNote] = useState({ note: "", type: "general", priority: "normal", visibility: "internal" });

  async function refreshAll() {
    const [d, t, n] = await Promise.all([
      loadDash({ data: { companyId } }),
      loadTl({ data: { companyId, types: Object.keys(tlTypes).filter((k) => tlTypes[k]) as any, search: tlSearch || undefined, limit: 200 } }),
      loadNotes({ data: { companyId } }),
    ]);
    setDash(d); setTl(t.items); setNotes(n.notes);
  }

  useEffect(() => { refreshAll().catch((e) => toast.error(e.message)); markViewed({ data: { companyId } }).catch(() => {}); /* eslint-disable-next-line */ }, [companyId]);
  useEffect(() => {
    if (!dash) return;
    loadTl({ data: { companyId, types: Object.keys(tlTypes).filter((k) => tlTypes[k]) as any, search: tlSearch || undefined, limit: 200 } })
      .then((r: any) => setTl(r.items));
    /* eslint-disable-next-line */
  }, [tlSearch, JSON.stringify(tlTypes)]);

  const suspended = !!(dash?.company as any)?.suspended_at;

  async function act(fn: () => Promise<any>, ok: string) {
    try { await fn(); toast.success(ok); await refreshAll(); } catch (e: any) { toast.error(e.message); }
  }

  if (!dash) return <div className="grid place-items-center py-20"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  const c = dash.company;
  const h = dash.health;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link to="/admin/support" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline">
            <ArrowLeft className="h-3 w-3" /> Centre support
          </Link>
          <h1 className="mt-1 text-2xl font-bold">{c.name}</h1>
          <div className="text-xs text-muted-foreground">{c.email ?? "—"} · {c.siret ?? c.siren ?? "—"}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={refreshAll}><RefreshCw className="mr-1 h-3 w-3" />Rafraîchir</Button>
          {suspended ? (
            <Button size="sm" onClick={() => act(() => reactivate({ data: { companyId } }), "Entreprise réactivée")}>
              <ShieldCheck className="mr-1 h-3 w-3" />Réactiver
            </Button>
          ) : (
            <Button size="sm" variant="destructive" onClick={() => {
              const reason = window.prompt("Raison de la suspension ?") ?? undefined;
              act(() => suspend({ data: { companyId, reason } }), "Entreprise suspendue");
            }}>
              <ShieldOff className="mr-1 h-3 w-3" />Suspendre
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => {
            const reason = window.prompt("Motif du mode support (min 3 caractères) ?") ?? "";
            if (reason.length < 3) return;
            act(async () => {
              const r = await startImp({ data: { companyId, reason } });
              toast.success(`Mode support actif jusqu'à ${new Date(r.expiresAt).toLocaleTimeString("fr-FR")}`);
            }, "Mode support ouvert");
          }}><Eye className="mr-1 h-3 w-3" />Mode support</Button>
        </div>
      </div>

      {/* A. Health */}
      <div className="grid gap-4 md:grid-cols-[auto_1fr]">
        <Card className="flex items-center justify-center p-4">
          <HealthRing score={h.score} level={h.level} />
        </Card>
        <Card className="p-4">
          <div className="mb-2 flex items-center gap-2">
            <h2 className="text-sm font-semibold">Santé globale</h2>
            <Badge variant={suspended ? "destructive" : c.onboarding_completed_at ? "default" : "outline"}>
              {suspended ? "Suspendue" : c.onboarding_completed_at ? "Active" : "Onboarding"}
            </Badge>
            {dash.subscription && <Badge variant="outline">{dash.subscription.status} · {dash.subscription.plan}</Badge>}
          </div>
          {h.alerts.length === 0 ? (
            <p className="text-xs text-muted-foreground">Aucune alerte. RAS.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {h.alerts.map((a: any) => (
                <li key={a.key} className="flex items-start gap-2">
                  <Badge variant={a.level === "high" ? "destructive" : a.level === "medium" ? "default" : "outline"}>{a.level}</Badge>
                  <div>
                    <div className="font-medium">{a.message}</div>
                    <div className="text-xs text-muted-foreground">→ {a.recommendation}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* B/C/D Stats grid */}
      <div className="grid gap-3 md:grid-cols-4">
        <Card className="p-3"><div className="text-xs text-muted-foreground">PV brouillon</div><div className="text-xl font-bold">{dash.pipeline.pvDraft}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">En attente signature</div><div className="text-xl font-bold">{dash.pipeline.pvAwaitingSignature}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">PV avec réserves ouvertes</div><div className="text-xl font-bold">{dash.pipeline.pvWithOpenReserves}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Levées en attente client</div><div className="text-xl font-bold">{dash.pipeline.liftsAwaiting}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Réserves ouvertes</div><div className="text-xl font-bold">{dash.pipeline.reservesOpen}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Membres actifs</div><div className="text-xl font-bold">{dash.counts.activeMembers}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Push enregistrés</div><div className="text-xl font-bold">{dash.integrations.pushCount}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Erreurs critiques 24h</div><div className="text-xl font-bold">{dash.counts.errorsCritical24h}</div></Card>
      </div>

      {/* Graphs */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-3">
          <div className="mb-1 flex justify-between text-xs"><span className="font-semibold">Emails échoués · 7j</span><span className="text-muted-foreground">{dash.counts.emailsFailed7d}/{dash.counts.emails7d}</span></div>
          <MiniBar data={dash.series.emails} color="#dc2626" />
        </Card>
        <Card className="p-3">
          <div className="mb-1 flex justify-between text-xs"><span className="font-semibold">Webhooks échoués · 7j</span><span className="text-muted-foreground">{dash.counts.webhooksFailed7d}/{dash.counts.webhooks7d}</span></div>
          <MiniBar data={dash.series.webhooks} color="#f59e0b" />
        </Card>
        <Card className="p-3">
          <div className="mb-1 flex justify-between text-xs"><span className="font-semibold">Erreurs · 7j</span><span className="text-muted-foreground">{dash.recentErrors.length}</span></div>
          <MiniBar data={dash.series.errors} color="#7c3aed" />
        </Card>
      </div>

      {/* Integrations */}
      <Card className="p-4">
        <h2 className="mb-2 text-sm font-semibold">Intégrations</h2>
        <div className="grid gap-2 text-sm md:grid-cols-4">
          <div>Stripe&nbsp;: <Badge variant={dash.integrations.stripeOk ? "default" : "outline"}>{dash.integrations.stripeOk ? "OK" : "non lié"}</Badge></div>
          <div>Calendrier&nbsp;: <Badge variant={dash.integrations.calendarConnected ? "default" : "outline"}>{dash.integrations.calendarConnected ? "OK" : "—"}</Badge></div>
          <div>Push&nbsp;: <Badge variant={dash.integrations.pushCount > 0 ? "default" : "outline"}>{dash.integrations.pushCount > 0 ? "actif" : "aucun"}</Badge></div>
          <div>Webhooks configurés&nbsp;: <Badge variant="outline">{dash.integrations.webhooks.length}</Badge></div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => act(() => resync({ data: { companyId } }), "Resync Stripe demandé")}>Resync Stripe</Button>
          <Button size="sm" variant="outline" onClick={() => act(() => resetOnb({ data: { companyId } }), "Onboarding réinitialisé")}><RotateCcw className="mr-1 h-3 w-3" />Reset onboarding</Button>
          <Button size="sm" variant="outline" onClick={() => act(() => clearNotifs({ data: { companyId } }), "Notifications d'erreur effacées")}><Bell className="mr-1 h-3 w-3" />Vider notifs erreur</Button>
        </div>
      </Card>

      {/* Members */}
      <Card className="p-4">
        <h2 className="mb-2 text-sm font-semibold">Membres ({dash.members.length})</h2>
        <div className="space-y-1 text-sm">
          {dash.members.map((m: any) => {
            const expired = m.status === "invited" && m.invite_expires_at && new Date(m.invite_expires_at) < new Date();
            return (
              <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-1.5 last:border-0">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{m.role}</Badge>
                  <Badge variant={m.status === "active" ? "default" : "outline"}>{m.status}</Badge>
                  <span className="text-xs">{m.invited_email ?? m.user_id?.slice(0, 8)}</span>
                  {expired && <Badge variant="destructive">invitation expirée</Badge>}
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {m.last_sign_in_at && <span>Dernière connexion : {new Date(m.last_sign_in_at).toLocaleDateString("fr-FR")}</span>}
                  {m.status === "invited" && (
                    <Button size="sm" variant="outline" onClick={() => act(() => resendInv({ data: { memberId: m.id } }), "Invitation prolongée")}>Réenvoyer</Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Timeline */}
      <Card className="p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Timeline support fusionnée</h2>
          <div className="flex flex-wrap gap-1">
            {(["audit", "email", "webhook", "error", "notification"] as const).map((k) => (
              <Button key={k} size="sm" variant={tlTypes[k] ? "default" : "outline"} onClick={() => setTlTypes((p) => ({ ...p, [k]: !p[k] }))}>{k}</Button>
            ))}
          </div>
        </div>
        <Input placeholder="Recherche…" value={tlSearch} onChange={(e) => setTlSearch(e.target.value)} className="mb-3 max-w-sm" />
        <ul className="max-h-96 space-y-1 overflow-auto text-sm">
          {tl.map((it: any) => {
            const Icon = it.kind === "email" ? Mail : it.kind === "webhook" ? Webhook : it.kind === "error" ? Bug : it.kind === "notification" ? Bell : FileText;
            return (
              <li key={it.id} className="flex gap-2 border-b py-1.5">
                <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${it.severity === "error" ? "text-destructive" : it.severity === "warn" ? "text-amber-600" : "text-muted-foreground"}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium truncate">{it.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{new Date(it.created_at).toLocaleString("fr-FR")}</span>
                  </div>
                  {it.detail && <div className="text-xs text-muted-foreground line-clamp-2">{it.detail}</div>}
                  {it.pv_id && <Link to="/pv/$id" params={{ id: it.pv_id }} className="text-xs text-primary hover:underline">PV →</Link>}
                </div>
              </li>
            );
          })}
          {tl.length === 0 && <li className="py-4 text-center text-xs text-muted-foreground">Aucun événement.</li>}
        </ul>
      </Card>

      {/* Errors actions */}
      <Card className="p-4">
        <h2 className="mb-2 text-sm font-semibold">Erreurs ouvertes</h2>
        <ul className="space-y-1 text-sm">
          {dash.recentErrors.filter((e: any) => !e.resolved).map((e: any) => (
            <li key={e.id} className="flex items-start justify-between gap-2 border-b py-1.5">
              <div>
                <div><Badge variant={e.severity === "critical" ? "destructive" : "outline"}>{e.severity}</Badge> <span className="font-medium">{e.source}</span></div>
                <div className="text-xs text-muted-foreground line-clamp-2">{e.message}</div>
              </div>
              <Button size="sm" variant="outline" onClick={() => act(() => markErr({ data: { errorId: e.id, companyId } }), "Erreur résolue")}><CheckCircle2 className="mr-1 h-3 w-3" />Résolu</Button>
            </li>
          ))}
          {dash.recentErrors.filter((e: any) => !e.resolved).length === 0 && <li className="text-xs text-muted-foreground">Aucune erreur ouverte.</li>}
        </ul>
      </Card>

      {/* Notes */}
      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold">Notes support ({notes.length})</h2>
        <div className="mb-3 space-y-2">
          <Textarea placeholder="Note interne, incident, action effectuée…" value={newNote.note} onChange={(e) => setNewNote({ ...newNote, note: e.target.value })} rows={2} />
          <div className="flex flex-wrap gap-2">
            <Select value={newNote.type} onValueChange={(v) => setNewNote({ ...newNote, type: v })}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["general", "incident", "billing", "onboarding", "bug", "customer-success"].map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={newNote.priority} onValueChange={(v) => setNewNote({ ...newNote, priority: v })}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["high", "normal", "low"].map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={newNote.visibility} onValueChange={(v) => setNewNote({ ...newNote, visibility: v })}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="internal">Interne</SelectItem>
                <SelectItem value="customer_visible">Visible client</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" onClick={() => {
              if (!newNote.note.trim()) return;
              act(async () => { await addNote({ data: { companyId, ...(newNote as any) } }); setNewNote({ ...newNote, note: "" }); }, "Note ajoutée");
            }}>Ajouter</Button>
          </div>
        </div>
        <ul className="space-y-2 text-sm">
          {notes.map((n: any) => (
            <li key={n.id} className={`rounded border p-2 ${n.status === "resolved" ? "opacity-60" : ""}`}>
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <Badge variant={n.priority === "high" ? "destructive" : "outline"}>{n.priority}</Badge>
                <Badge variant="outline">{n.type}</Badge>
                <Badge variant={n.visibility === "internal" ? "outline" : "default"}>{n.visibility}</Badge>
                <Badge variant={n.status === "resolved" ? "default" : "outline"}>{n.status}</Badge>
                <span className="ml-auto text-muted-foreground">{new Date(n.created_at).toLocaleString("fr-FR")}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap">{n.note}</p>
              <div className="mt-1 flex justify-end">
                <Button size="sm" variant="outline" onClick={() => act(() => resolveNote({ data: { id: n.id, companyId, status: n.status === "resolved" ? "open" : "resolved" } }), "Note mise à jour")}>
                  {n.status === "resolved" ? "Rouvrir" : "Marquer résolu"}
                </Button>
              </div>
            </li>
          ))}
          {notes.length === 0 && <li className="text-xs text-muted-foreground">Aucune note.</li>}
        </ul>
      </Card>
    </div>
  );
}

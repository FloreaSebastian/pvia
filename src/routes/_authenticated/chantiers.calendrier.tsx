import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusPill } from "@/components/ui/status-pill";
import { PageHeader } from "@/components/app/PageHeader";
import { useCompany } from "@/hooks/use-company";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { listChantierEvents, createChantierEvent, listCompanyMembers, rescheduleChantierEvent } from "@/lib/chantier-detail.functions";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/chantiers/calendrier")({
  component: ChantierCalendarPage,
  head: () => ({ meta: [{ title: "Calendrier chantier — PVIA" }] }),
});

type Evt = { id: string; title: string; event_type: string; status: string; start_at: string | null; end_at: string | null; chantier_id: string; client_id: string | null; location: string | null; description: string | null; assigned_to: string | null; reminder_at: string | null; chantier?: { id: string; name: string } | null; client?: { id: string; name: string } | null };

const TYPE_COLORS: Record<string, string> = {
  visite_technique: "bg-blue-500", debut_travaux: "bg-emerald-500", livraison_materiel: "bg-cyan-500",
  intervention: "bg-primary", controle_qualite: "bg-amber-500", reception: "bg-green-600",
  sav: "bg-orange-500", retard: "bg-red-500", remarque: "bg-slate-500",
  appel_client: "bg-purple-500", rappel: "bg-gray-500",
  system_pv_created: "bg-indigo-500", system_pv_signed: "bg-indigo-700",
  system_reserve_created: "bg-yellow-500", system_reserve_lifted: "bg-yellow-700",
};
const TYPE_LABELS: Record<string, string> = {
  visite_technique: "Visite technique", debut_travaux: "Début travaux", livraison_materiel: "Livraison",
  intervention: "Intervention", controle_qualite: "Contrôle qualité", reception: "Réception",
  sav: "SAV", retard: "Retard", remarque: "Remarque", appel_client: "Appel client", rappel: "Rappel",
};

function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function startOfWeek(d: Date) { const day = (d.getDay() + 6) % 7; const r = new Date(d); r.setDate(d.getDate() - day); r.setHours(0,0,0,0); return r; }
function addDays(d: Date, n: number) { const r = new Date(d); r.setDate(d.getDate() + n); return r; }
function sameDay(a: Date, b: Date) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function fmtMonth(d: Date) { return d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }); }

function ChantierCalendarPage() {
  const { activeCompanyId, can } = useCompany();
  const canWrite = can("manage");
  const navigate = useNavigate();
  const [view, setView] = useState<"month" | "week" | "day" | "list">("month");
  const [cursor, setCursor] = useState(new Date());
  const [events, setEvents] = useState<Evt[]>([]);
  const [loading, setLoading] = useState(true);

  const [chantiers, setChantiers] = useState<{ id: string; name: string }[]>([]);
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [members, setMembers] = useState<{ user_id: string; name: string }[]>([]);
  const [fChantier, setFChantier] = useState<string>("all");
  const [fClient, setFClient] = useState<string>("all");
  const [fType, setFType] = useState<string>("all");
  const [fStatus, setFStatus] = useState<string>("all");
  const [fAssigned, setFAssigned] = useState<string>("all");

  const fetchEvents = useServerFn(listChantierEvents);
  const createEvtFn = useServerFn(createChantierEvent);
  const fetchMembers = useServerFn(listCompanyMembers);
  const rescheduleFn = useServerFn(rescheduleChantierEvent);
  const membersById = useMemo(() => new Map(members.map((m) => [m.user_id, m])), [members]);

  const range = useMemo(() => {
    if (view === "month") return { from: startOfWeek(startOfMonth(cursor)), to: addDays(startOfWeek(endOfMonth(cursor)), 41) };
    if (view === "week") return { from: startOfWeek(cursor), to: addDays(startOfWeek(cursor), 6) };
    if (view === "day") { const d = new Date(cursor); d.setHours(0,0,0,0); return { from: d, to: addDays(d, 0) }; }
    return { from: startOfMonth(cursor), to: endOfMonth(cursor) };
  }, [cursor, view]);

  async function load() {
    if (!activeCompanyId) return;
    setLoading(true);
    try {
      const r = await fetchEvents({ data: {
        companyId: activeCompanyId,
        from: range.from.toISOString(),
        to: addDays(range.to, 1).toISOString(),
        chantierId: fChantier === "all" ? null : fChantier,
        clientId: fClient === "all" ? null : fClient,
        eventType: fType === "all" ? null : fType,
        status: fStatus === "all" ? null : fStatus,
        assignedTo: fAssigned === "all" ? null : fAssigned,
      } });
      setEvents(r.events as Evt[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Chargement impossible");
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activeCompanyId, view, cursor, fChantier, fClient, fType, fStatus, fAssigned]);

  useEffect(() => {
    if (!activeCompanyId) return;
    void (async () => {
      const [c1, c2] = await Promise.all([
        supabase.from("chantiers").select("id,name").eq("company_id", activeCompanyId).order("name"),
        supabase.from("clients").select("id,name").eq("company_id", activeCompanyId).order("name"),
      ]);
      setChantiers((c1.data as { id: string; name: string }[]) ?? []);
      setClients((c2.data as { id: string; name: string }[]) ?? []);
      try {
        const r = await fetchMembers({ data: { companyId: activeCompanyId } });
        setMembers(r.members);
      } catch { /* non-blocking */ }
    })();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [activeCompanyId]);

  // Drag-and-drop: move event to a new day (preserves time-of-day)
  const [dragId, setDragId] = useState<string | null>(null);
  async function handleDrop(targetDay: Date, eventId: string) {
    if (!activeCompanyId) return;
    const evt = events.find((e) => e.id === eventId);
    if (!evt || !evt.start_at) return;
    const orig = new Date(evt.start_at);
    const next = new Date(targetDay);
    next.setHours(orig.getHours(), orig.getMinutes(), 0, 0);
    if (sameDay(orig, next)) return;
    const ok = confirm(`Déplacer "${evt.title}" au ${next.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })} ?`);
    if (!ok) return;
    let nextEnd: string | null = null;
    if (evt.end_at) {
      const origEnd = new Date(evt.end_at);
      const diff = origEnd.getTime() - orig.getTime();
      nextEnd = new Date(next.getTime() + diff).toISOString();
    }
    try {
      await rescheduleFn({ data: { companyId: activeCompanyId, id: eventId, start_at: next.toISOString(), end_at: nextEnd } });
      toast.success("Événement déplacé");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Déplacement impossible");
    }
  }

  // New event dialog
  const [evtOpen, setEvtOpen] = useState(false);
  const [evtForm, setEvtForm] = useState({ chantier_id: "", title: "", event_type: "intervention", status: "prevu", start_at: "", end_at: "", location: "", description: "" });
  function openNew(date?: Date) {
    setEvtForm({
      chantier_id: fChantier !== "all" ? fChantier : (chantiers[0]?.id ?? ""),
      title: "", event_type: "intervention", status: "prevu",
      start_at: date ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "",
      end_at: "", location: "", description: "",
    });
    setEvtOpen(true);
  }
  async function saveEvt(e: React.FormEvent) {
    e.preventDefault();
    if (!activeCompanyId || !evtForm.chantier_id) { toast.error("Choisissez un chantier."); return; }
    try {
      await createEvtFn({ data: { companyId: activeCompanyId, chantierId: evtForm.chantier_id, data: {
        title: evtForm.title, description: evtForm.description, event_type: evtForm.event_type, status: evtForm.status as "prevu",
        start_at: evtForm.start_at ? new Date(evtForm.start_at).toISOString() : null,
        end_at: evtForm.end_at ? new Date(evtForm.end_at).toISOString() : null,
        all_day: false, location: evtForm.location, color: "",
      } } });
      toast.success("Événement créé");
      setEvtOpen(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Échec");
    }
  }

  // Build month grid
  const monthGrid = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor));
    const days: Date[] = [];
    for (let i = 0; i < 42; i++) days.push(addDays(start, i));
    return days;
  }, [cursor]);

  function eventsOn(day: Date) {
    return events.filter((e) => e.start_at && sameDay(new Date(e.start_at), day));
  }

  function nav(dir: -1 | 1) {
    if (view === "month") setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + dir, 1));
    else if (view === "week") setCursor(addDays(cursor, 7 * dir));
    else setCursor(addDays(cursor, dir));
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Calendrier chantier"
        description="Visualisez et planifiez tous vos événements de chantier."
        contained={false}
        className="border-0 bg-transparent px-0 py-0"
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm"><Link to="/chantiers"><ArrowLeft className="h-4 w-4" /> Chantiers</Link></Button>
            {canWrite && <Button onClick={() => openNew()} className="shadow-brand"><Plus className="h-4 w-4" /> Nouvel événement</Button>}
          </div>
        }
      />

      {/* Toolbar */}
      <Card className="flex flex-col gap-3 p-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          <Button size="icon" variant="outline" onClick={() => nav(-1)}><ChevronLeft className="h-4 w-4" /></Button>
          <div className="min-w-[180px] text-center font-semibold capitalize">
            {view === "month" ? fmtMonth(cursor) : view === "week"
              ? `${startOfWeek(cursor).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })} – ${addDays(startOfWeek(cursor), 6).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })}`
              : cursor.toLocaleDateString("fr-FR", { weekday: "long", day: "2-digit", month: "long" })}
          </div>
          <Button size="icon" variant="outline" onClick={() => nav(1)}><ChevronRight className="h-4 w-4" /></Button>
          <Button size="sm" variant="ghost" onClick={() => setCursor(new Date())}>Aujourd'hui</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(["month","week","day","list"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)}
              className={cn("rounded-md px-3 py-1.5 text-xs font-medium transition",
                view === v ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground")}>
              {v === "month" ? "Mois" : v === "week" ? "Semaine" : v === "day" ? "Jour" : "Liste"}
            </button>
          ))}
        </div>
      </Card>

      {/* Filters */}
      <Card className="grid gap-3 p-3 md:grid-cols-5">
        <Select value={fChantier} onValueChange={setFChantier}>
          <SelectTrigger><SelectValue placeholder="Chantier" /></SelectTrigger>
          <SelectContent><SelectItem value="all">Tous les chantiers</SelectItem>{chantiers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={fClient} onValueChange={setFClient}>
          <SelectTrigger><SelectValue placeholder="Client" /></SelectTrigger>
          <SelectContent><SelectItem value="all">Tous les clients</SelectItem>{clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={fType} onValueChange={setFType}>
          <SelectTrigger><SelectValue placeholder="Type" /></SelectTrigger>
          <SelectContent><SelectItem value="all">Tous les types</SelectItem>{Object.entries(TYPE_LABELS).map(([k,l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={fStatus} onValueChange={setFStatus}>
          <SelectTrigger><SelectValue placeholder="Statut" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous les statuts</SelectItem>
            <SelectItem value="prevu">Prévu</SelectItem><SelectItem value="en_cours">En cours</SelectItem>
            <SelectItem value="termine">Terminé</SelectItem><SelectItem value="annule">Annulé</SelectItem>
            <SelectItem value="reporte">Reporté</SelectItem>
          </SelectContent>
        </Select>
        <Select value={fAssigned} onValueChange={setFAssigned}>
          <SelectTrigger><SelectValue placeholder="Assigné" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous les membres</SelectItem>
            {members.map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </Card>

      {/* Views */}
      {loading && <div className="p-8 text-center text-sm text-muted-foreground">Chargement…</div>}

      {!loading && view === "month" && (
        <Card className="overflow-hidden p-0">
          <div className="grid grid-cols-7 border-b border-border bg-muted/40 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"].map((d) => <div key={d} className="p-2 text-center">{d}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {monthGrid.map((day, i) => {
              const inMonth = day.getMonth() === cursor.getMonth();
              const dayEvts = eventsOn(day);
              const isToday = sameDay(day, new Date());
              return (
                <div key={i}
                  onClick={() => canWrite && openNew(day)}
                  onDragOver={(e) => { if (canWrite && dragId) e.preventDefault(); }}
                  onDrop={(e) => { e.preventDefault(); if (canWrite && dragId) { const id = dragId; setDragId(null); void handleDrop(day, id); } }}
                  className={cn("min-h-[90px] cursor-pointer border-b border-r border-border p-1.5 text-left text-xs transition hover:bg-muted/30",
                    !inMonth && "bg-muted/10 text-muted-foreground", isToday && "ring-2 ring-inset ring-primary/40")}>
                  <div className={cn("mb-1 inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold", isToday && "bg-primary text-primary-foreground")}>{day.getDate()}</div>
                  <div className="space-y-0.5">
                    {dayEvts.slice(0, 3).map((e) => {
                      const isSystem = e.event_type.startsWith("system_");
                      const draggable = canWrite && !isSystem && !!e.start_at;
                      return (
                        <div key={e.id}
                          draggable={draggable}
                          onDragStart={() => { if (draggable) setDragId(e.id); }}
                          onDragEnd={() => setDragId(null)}
                          onClick={(ev) => { ev.stopPropagation(); navigate({ to: "/chantiers/$id", params: { id: e.chantier_id } }); }}
                          className={cn("truncate rounded px-1 py-0.5 text-[10px] text-white", TYPE_COLORS[e.event_type] ?? "bg-slate-500", draggable && "cursor-grab active:cursor-grabbing")}
                          title={`${e.title}${e.assigned_to ? ` — ${membersById.get(e.assigned_to)?.name ?? ""}` : ""}`}>
                          {e.title}
                        </div>
                      );
                    })}
                    {dayEvts.length > 3 && <div className="text-[10px] text-muted-foreground">+{dayEvts.length - 3}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {!loading && (view === "week" || view === "day" || view === "list") && (
        <Card className="p-3">
          {events.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">Aucun événement sur la période.</p>
          ) : (
            <ul className="divide-y divide-border">
              {events.map((e) => (
                <li key={e.id} className="flex cursor-pointer items-start gap-3 py-3 hover:bg-muted/30"
                  onClick={() => navigate({ to: "/chantiers/$id", params: { id: e.chantier_id } })}>
                  <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", TYPE_COLORS[e.event_type] ?? "bg-slate-500")} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium leading-tight">{e.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {e.start_at ? new Date(e.start_at).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}
                      {e.chantier && <> · {e.chantier.name}</>}
                      {e.location && <> · {e.location}</>}
                      {e.assigned_to && <> · 👤 {membersById.get(e.assigned_to)?.name ?? "—"}</>}
                    </p>
                  </div>
                  <StatusPill tone="neutral">{TYPE_LABELS[e.event_type] ?? e.event_type}</StatusPill>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* Create dialog */}
      <Dialog open={evtOpen} onOpenChange={setEvtOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Nouvel événement</DialogTitle></DialogHeader>
          <form onSubmit={saveEvt} className="space-y-3">
            <div>
              <Label>Chantier *</Label>
              <Select value={evtForm.chantier_id} onValueChange={(v) => setEvtForm({ ...evtForm, chantier_id: v })}>
                <SelectTrigger><SelectValue placeholder="Choisir un chantier" /></SelectTrigger>
                <SelectContent>{chantiers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Titre *</Label><Input required value={evtForm.title} onChange={(e) => setEvtForm({ ...evtForm, title: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Type</Label>
                <Select value={evtForm.event_type} onValueChange={(v) => setEvtForm({ ...evtForm, event_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(TYPE_LABELS).map(([k,l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Statut</Label>
                <Select value={evtForm.status} onValueChange={(v) => setEvtForm({ ...evtForm, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="prevu">Prévu</SelectItem><SelectItem value="en_cours">En cours</SelectItem>
                    <SelectItem value="termine">Terminé</SelectItem><SelectItem value="annule">Annulé</SelectItem>
                    <SelectItem value="reporte">Reporté</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Début</Label><Input type="datetime-local" value={evtForm.start_at} onChange={(e) => setEvtForm({ ...evtForm, start_at: e.target.value })} /></div>
              <div><Label>Fin</Label><Input type="datetime-local" value={evtForm.end_at} onChange={(e) => setEvtForm({ ...evtForm, end_at: e.target.value })} /></div>
            </div>
            <div><Label>Lieu</Label><Input value={evtForm.location} onChange={(e) => setEvtForm({ ...evtForm, location: e.target.value })} /></div>
            <div><Label>Description</Label><Textarea value={evtForm.description} onChange={(e) => setEvtForm({ ...evtForm, description: e.target.value })} /></div>
            <DialogFooter><Button type="submit" className="shadow-brand">Créer</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

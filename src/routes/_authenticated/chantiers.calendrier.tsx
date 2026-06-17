import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Plus, X, Trash2, Copy, CalendarDays, Search, Pencil, AlertTriangle, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/app/PageHeader";
import { useCompany } from "@/hooks/use-company";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import {
  listChantierEvents, createChantierEvent, updateChantierEvent, deleteChantierEvent,
  listCompanyMembers, rescheduleChantierEvent, resizeChantierEvent, duplicateChantierEvent,
  reassignChantierEvent,
} from "@/lib/chantier-detail.functions";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/chantiers/calendrier")({
  component: ChantierCalendarPage,
  head: () => ({ meta: [{ title: "Calendrier — PVIA" }] }),
});

type Evt = {
  id: string; title: string; event_type: string; status: string;
  start_at: string | null; end_at: string | null; all_day: boolean | null;
  chantier_id: string; client_id: string | null;
  location: string | null; description: string | null;
  assigned_to: string | null; reminder_at: string | null;
  color: string | null; color_source: string | null;
  chantier?: { id: string; name: string } | null;
  client?: { id: string; name: string } | null;
};

// ----- Palette (Google-Agenda style) -----
const COLORS = [
  { key: "blue",   label: "Bleu",    bg: "#3b82f6", fg: "#ffffff" },
  { key: "green",  label: "Vert",    bg: "#10b981", fg: "#ffffff" },
  { key: "orange", label: "Orange",  bg: "#f97316", fg: "#ffffff" },
  { key: "red",    label: "Rouge",   bg: "#ef4444", fg: "#ffffff" },
  { key: "purple", label: "Violet",  bg: "#8b5cf6", fg: "#ffffff" },
  { key: "yellow", label: "Jaune",   bg: "#eab308", fg: "#1f2937" },
  { key: "gray",   label: "Gris",    bg: "#6b7280", fg: "#ffffff" },
  { key: "sky",    label: "Bleu clair", bg: "#0ea5e9", fg: "#ffffff" },
  { key: "slate",  label: "Gris foncé", bg: "#334155", fg: "#ffffff" },
] as const;
type ColorKey = typeof COLORS[number]["key"];

const TYPE_TO_COLOR: Record<string, ColorKey> = {
  visite_technique: "blue", intervention: "green", pose: "purple",
  livraison_materiel: "orange", controle_qualite: "yellow", reception: "red",
  sav: "gray", appel_client: "sky", rappel: "slate",
  debut_travaux: "green", retard: "red", remarque: "gray",
  system_pv_created: "slate", system_pv_signed: "slate",
  system_reserve_created: "yellow", system_reserve_lifted: "yellow",
};
const TYPE_LABELS: Record<string, string> = {
  visite_technique: "Visite technique", intervention: "Intervention", pose: "Pose",
  livraison_materiel: "Livraison matériel", controle_qualite: "Contrôle",
  reception: "Réception", sav: "SAV", appel_client: "Appel client",
  rappel: "Rappel administratif", debut_travaux: "Début travaux",
  retard: "Retard", remarque: "Remarque",
};
function colorOf(e: Evt): { bg: string; fg: string; key: ColorKey } {
  const k: ColorKey = (e.color && COLORS.some((c) => c.key === e.color))
    ? (e.color as ColorKey)
    : (TYPE_TO_COLOR[e.event_type] ?? "blue");
  const c = COLORS.find((c) => c.key === k)!;
  return { bg: c.bg, fg: c.fg, key: k };
}

// ----- Date helpers -----
function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function startOfWeek(d: Date) { const day = (d.getDay() + 6) % 7; const r = new Date(d); r.setDate(d.getDate() - day); r.setHours(0,0,0,0); return r; }
function addDays(d: Date, n: number) { const r = new Date(d); r.setDate(d.getDate() + n); return r; }
function sameDay(a: Date, b: Date) { return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }
function fmtMonth(d: Date) { return d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }); }
function fmtTime(d: Date) { return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }); }
function toLocalInput(d: Date) { return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }

type ViewKind = "month" | "week" | "day" | "list" | "custom" | "team";
type TeamMode = "day" | "week";

const UNASSIGNED = "__unassigned__";

function ChantierCalendarPage() {
  const { activeCompanyId, can } = useCompany();
  const canWrite = can("manage");
  const isAdmin = can("admin");
  
  const [view, setView] = useState<ViewKind>("month");
  const [cursor, setCursor] = useState(new Date());
  const [customStart, setCustomStart] = useState(() => toLocalInput(new Date()).slice(0,10));
  const [customEnd, setCustomEnd] = useState(() => toLocalInput(addDays(new Date(), 4)).slice(0,10));
  const [events, setEvents] = useState<Evt[]>([]);
  const [loading, setLoading] = useState(true);

  const [chantiers, setChantiers] = useState<{ id: string; name: string }[]>([]);
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [members, setMembers] = useState<{ user_id: string; name: string }[]>([]);
  const [fChantier, setFChantier] = useState("all");
  const [fClient, setFClient] = useState("all");
  const [fType, setFType] = useState("all");
  const [fStatus, setFStatus] = useState("all");
  const [fAssigned, setFAssigned] = useState("all");
  const [fColor, setFColor] = useState("all");
  const [fOnlyUnassigned, setFOnlyUnassigned] = useState(false);
  const [fHideDone, setFHideDone] = useState(false);
  const [fHideCancelled, setFHideCancelled] = useState(false);
  const [teamMode, setTeamMode] = useState<TeamMode>("day");

  const fetchEvents = useServerFn(listChantierEvents);
  const createEvtFn = useServerFn(createChantierEvent);
  const updateEvtFn = useServerFn(updateChantierEvent);
  const deleteEvtFn = useServerFn(deleteChantierEvent);
  const reassignFn = useServerFn(reassignChantierEvent);
  const fetchMembers = useServerFn(listCompanyMembers);
  const rescheduleFn = useServerFn(rescheduleChantierEvent);
  const resizeFn = useServerFn(resizeChantierEvent);
  const duplicateFn = useServerFn(duplicateChantierEvent);
  const membersById = useMemo(() => new Map(members.map((m) => [m.user_id, m])), [members]);

  const range = useMemo(() => {
    if (view === "month") return { from: startOfWeek(startOfMonth(cursor)), to: addDays(startOfWeek(endOfMonth(cursor)), 41) };
    if (view === "week") return { from: startOfWeek(cursor), to: addDays(startOfWeek(cursor), 6) };
    if (view === "day") { const d = new Date(cursor); d.setHours(0,0,0,0); return { from: d, to: d }; }
    if (view === "custom") {
      const a = new Date(customStart + "T00:00:00");
      const b = new Date(customEnd + "T00:00:00");
      return { from: a, to: b >= a ? b : a };
    }
    return { from: startOfMonth(cursor), to: endOfMonth(cursor) };
  }, [cursor, view, customStart, customEnd]);

  const load = useCallback(async () => {
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
      let list = r.events as Evt[];
      if (fColor !== "all") list = list.filter((e) => colorOf(e).key === fColor);
      setEvents(list);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Chargement impossible");
    } finally { setLoading(false); }
  }, [activeCompanyId, fetchEvents, range.from, range.to, fChantier, fClient, fType, fStatus, fAssigned, fColor]);

  useEffect(() => { void load(); }, [load]);

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
  }, [activeCompanyId, fetchMembers]);

  function resetFilters() {
    setFChantier("all"); setFClient("all"); setFType("all"); setFStatus("all"); setFAssigned("all"); setFColor("all");
  }

  // ----- Event dialog -----
  type FormState = {
    id: string | null;
    chantier_id: string; client_id: string; assigned_to: string;
    title: string; event_type: string; status: string;
    start_at: string; end_at: string; all_day: boolean;
    location: string; description: string;
    color: ColorKey | "";
    color_source: "auto" | "manual";
    reminder_at: string;
  };
  const blankForm = (preset?: Partial<FormState>): FormState => ({
    id: null,
    chantier_id: fChantier !== "all" ? fChantier : (chantiers[0]?.id ?? ""),
    client_id: "", assigned_to: "",
    title: "", event_type: "intervention", status: "prevu",
    start_at: "", end_at: "", all_day: false,
    location: "", description: "",
    color: "", color_source: "auto",
    reminder_at: "",
    ...preset,
  });
  const [evtOpen, setEvtOpen] = useState(false);
  const [evtForm, setEvtForm] = useState<FormState>(blankForm());
  const [quickEvt, setQuickEvt] = useState<Evt | null>(null);
  const [search, setSearch] = useState("");
  const chantierName = useCallback((id: string | null | undefined) => id ? (chantiers.find((c) => c.id === id)?.name ?? "—") : "—", [chantiers]);
  const clientName = useCallback((id: string | null | undefined) => id ? (clients.find((c) => c.id === id)?.name ?? "—") : "—", [clients]);
  const memberName = useCallback((id: string | null | undefined) => id ? (membersById.get(id)?.name ?? "—") : null, [membersById]);

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length < 2) return [];
    return events
      .filter((e) => {
        const hay = `${e.title} ${chantierName(e.chantier_id)} ${clientName(e.client_id)}`.toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 10);
  }, [events, search, chantierName, clientName]);

  function openQuick(e: Evt) {
    if (e.event_type.startsWith("system_")) return;
    setQuickEvt(e);
  }
  function jumpToEvent(e: Evt) {
    if (e.start_at) setCursor(new Date(e.start_at));
    setView("day");
    setSearch("");
    setQuickEvt(e);
  }

  function openNew(start?: Date, end?: Date) {
    if (!canWrite) return;
    setEvtForm(blankForm({
      start_at: start ? toLocalInput(start) : "",
      end_at: end ? toLocalInput(end) : (start ? toLocalInput(new Date(start.getTime() + 60*60*1000)) : ""),
    }));
    setEvtOpen(true);
  }
  function openEdit(e: Evt) {
    if (e.event_type.startsWith("system_")) return;
    setEvtForm({
      id: e.id, chantier_id: e.chantier_id,
      client_id: e.client_id ?? "", assigned_to: e.assigned_to ?? "",
      title: e.title, event_type: e.event_type, status: e.status,
      start_at: e.start_at ? toLocalInput(new Date(e.start_at)) : "",
      end_at: e.end_at ? toLocalInput(new Date(e.end_at)) : "",
      all_day: !!e.all_day,
      location: e.location ?? "", description: e.description ?? "",
      color: ((e.color && COLORS.some((c) => c.key === e.color)) ? e.color : "") as ColorKey | "",
      color_source: (e.color_source as "auto" | "manual") ?? "auto",
      reminder_at: e.reminder_at ? toLocalInput(new Date(e.reminder_at)) : "",
    });
    setEvtOpen(true);
  }

  async function saveEvt(ev: React.FormEvent) {
    ev.preventDefault();
    if (!activeCompanyId || !evtForm.chantier_id) { toast.error("Choisissez un chantier."); return; }
    const payload = {
      title: evtForm.title, description: evtForm.description,
      event_type: evtForm.event_type, status: evtForm.status as "prevu",
      start_at: evtForm.start_at ? new Date(evtForm.start_at).toISOString() : null,
      end_at: evtForm.end_at ? new Date(evtForm.end_at).toISOString() : null,
      all_day: evtForm.all_day,
      assigned_to: evtForm.assigned_to || null,
      client_id: evtForm.client_id || null,
      reminder_at: evtForm.reminder_at ? new Date(evtForm.reminder_at).toISOString() : null,
      location: evtForm.location,
      color: evtForm.color || "",
      color_source: evtForm.color_source,
    };
    try {
      if (evtForm.id) {
        await updateEvtFn({ data: { companyId: activeCompanyId, id: evtForm.id, data: payload } });
        toast.success("Événement mis à jour");
      } else {
        await createEvtFn({ data: { companyId: activeCompanyId, chantierId: evtForm.chantier_id, data: payload } });
        toast.success("Événement créé");
      }
      setEvtOpen(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Échec");
    }
  }

  async function removeEvt() {
    if (!activeCompanyId || !evtForm.id) return;
    if (!confirm("Supprimer cet événement ?")) return;
    try {
      await deleteEvtFn({ data: { companyId: activeCompanyId, id: evtForm.id } });
      toast.success("Supprimé");
      setEvtOpen(false);
      await load();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Suppression impossible"); }
  }
  async function duplicateEvt() {
    if (!activeCompanyId || !evtForm.id) return;
    try {
      await duplicateFn({ data: { companyId: activeCompanyId, id: evtForm.id } });
      toast.success("Événement dupliqué");
      setEvtOpen(false);
      await load();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Duplication impossible"); }
  }

  // ----- Drag commits -----


  async function commitReschedule(id: string, start: Date, end: Date | null) {
    if (!activeCompanyId) return;
    try {
      await rescheduleFn({ data: { companyId: activeCompanyId, id, start_at: start.toISOString(), end_at: end ? end.toISOString() : null } });
      toast.success("Événement déplacé");
      await load();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Déplacement impossible"); await load(); }
  }
  async function commitResize(id: string, end: Date) {
    if (!activeCompanyId) return;
    try {
      await resizeFn({ data: { companyId: activeCompanyId, id, end_at: end.toISOString() } });
      toast.success("Durée mise à jour");
      await load();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Redimensionnement impossible"); await load(); }
  }

  // ----- Month view -----
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
    else if (view === "day") setCursor(addDays(cursor, dir));
    else if (view === "custom") {
      const days = Math.max(1, Math.round((new Date(customEnd).getTime() - new Date(customStart).getTime()) / 86400000) + 1);
      setCustomStart(toLocalInput(addDays(new Date(customStart + "T00:00:00"), days * dir)).slice(0,10));
      setCustomEnd(toLocalInput(addDays(new Date(customEnd + "T00:00:00"), days * dir)).slice(0,10));
    }
  }

  const periodLabel = useMemo(() => {
    if (view === "month") return fmtMonth(cursor);
    if (view === "week") {
      const s = startOfWeek(cursor); const e = addDays(s, 6);
      return `${s.toLocaleDateString("fr-FR", { day:"2-digit", month:"short" })} – ${e.toLocaleDateString("fr-FR", { day:"2-digit", month:"short", year:"numeric" })}`;
    }
    if (view === "day") return cursor.toLocaleDateString("fr-FR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
    if (view === "custom") {
      const a = new Date(customStart + "T00:00:00"); const b = new Date(customEnd + "T00:00:00");
      return `${a.toLocaleDateString("fr-FR",{day:"2-digit",month:"short"})} – ${b.toLocaleDateString("fr-FR",{day:"2-digit",month:"short",year:"numeric"})}`;
    }
    return "Liste";
  }, [view, cursor, customStart, customEnd]);

  return (
    <div className="space-y-3">
      <PageHeader
        title="Calendrier"
        description="Vue chantier façon Google Agenda."
        contained={false}
        className="border-0 bg-transparent px-0 py-0"
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm"><Link to="/chantiers"><ArrowLeft className="h-4 w-4" /> Chantiers</Link></Button>
            {canWrite && <Button onClick={() => openNew(new Date())} className="shadow-brand"><Plus className="h-4 w-4" /> Nouvel événement</Button>}
          </div>
        }
      />

      {/* Toolbar */}
      <Card className="flex flex-col gap-2 p-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setCursor(new Date())}>Aujourd'hui</Button>
          <Button size="icon" variant="ghost" onClick={() => nav(-1)} aria-label="Précédent"><ChevronLeft className="h-4 w-4" /></Button>
          <Button size="icon" variant="ghost" onClick={() => nav(1)} aria-label="Suivant"><ChevronRight className="h-4 w-4" /></Button>
          <div className="min-w-[180px] text-base font-semibold capitalize">{periodLabel}</div>
        </div>
        <div className="flex flex-1 items-center gap-2 lg:max-w-md">
          <Popover open={search.trim().length >= 2 && searchResults.length > 0} onOpenChange={(o) => { if (!o) setSearch(""); }}>
            <PopoverTrigger asChild>
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Rechercher un chantier, client ou événement…"
                  className="h-9 pl-8"
                />
              </div>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[min(420px,90vw)] p-1" onOpenAutoFocus={(e) => e.preventDefault()}>
              <ul className="max-h-80 overflow-y-auto">
                {searchResults.map((e) => {
                  const c = colorOf(e);
                  return (
                    <li key={e.id}>
                      <button type="button" onClick={() => jumpToEvent(e)}
                        className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted">
                        <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c.bg }} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{e.title}</span>
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {e.start_at ? new Date(e.start_at).toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "short" }) : "—"}
                            {e.start_at && !e.all_day && ` · ${fmtTime(new Date(e.start_at))}`}
                            {e.chantier_id && ` · ${chantierName(e.chantier_id)}`}
                            {e.client_id && ` · ${clientName(e.client_id)}`}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </PopoverContent>
          </Popover>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {(["month","week","day","list","custom"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)}
              className={cn("rounded-md px-3 py-1.5 text-xs font-medium transition",
                view === v ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
              {v === "month" ? "Mois" : v === "week" ? "Semaine" : v === "day" ? "Jour" : v === "list" ? "Liste" : "Personnalisé"}
            </button>
          ))}
        </div>
      </Card>

      {view === "custom" && (
        <Card className="flex flex-wrap items-end gap-3 p-3">
          <div><Label className="text-xs">Du</Label><Input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="h-9" /></div>
          <div><Label className="text-xs">Au</Label><Input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="h-9" /></div>
          <div className="flex flex-wrap gap-1">
            {[
              { label: "Lun → Ven", days: 4, from: startOfWeek(new Date()) },
              { label: "3 jours", days: 2, from: new Date() },
              { label: "10 jours", days: 9, from: new Date() },
            ].map((p) => (
              <Button key={p.label} size="sm" variant="outline" onClick={() => {
                setCustomStart(toLocalInput(p.from).slice(0,10));
                setCustomEnd(toLocalInput(addDays(p.from, p.days)).slice(0,10));
              }}>{p.label}</Button>
            ))}
          </div>
        </Card>
      )}

      {/* Filters */}
      <Card className="grid gap-2 p-2 md:grid-cols-6">
        <Select value={fChantier} onValueChange={setFChantier}>
          <SelectTrigger className="h-9"><SelectValue placeholder="Chantier" /></SelectTrigger>
          <SelectContent><SelectItem value="all">Tous chantiers</SelectItem>{chantiers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={fClient} onValueChange={setFClient}>
          <SelectTrigger className="h-9"><SelectValue placeholder="Client" /></SelectTrigger>
          <SelectContent><SelectItem value="all">Tous clients</SelectItem>{clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={fType} onValueChange={setFType}>
          <SelectTrigger className="h-9"><SelectValue placeholder="Type" /></SelectTrigger>
          <SelectContent><SelectItem value="all">Tous types</SelectItem>{Object.entries(TYPE_LABELS).map(([k,l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={fStatus} onValueChange={setFStatus}>
          <SelectTrigger className="h-9"><SelectValue placeholder="Statut" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous statuts</SelectItem>
            <SelectItem value="prevu">Prévu</SelectItem><SelectItem value="en_cours">En cours</SelectItem>
            <SelectItem value="termine">Terminé</SelectItem><SelectItem value="annule">Annulé</SelectItem>
            <SelectItem value="reporte">Reporté</SelectItem>
          </SelectContent>
        </Select>
        <Select value={fAssigned} onValueChange={setFAssigned}>
          <SelectTrigger className="h-9"><SelectValue placeholder="Assigné" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous membres</SelectItem>
            {members.map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1">
          <Select value={fColor} onValueChange={setFColor}>
            <SelectTrigger className="h-9"><SelectValue placeholder="Couleur" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes couleurs</SelectItem>
              {COLORS.map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="icon" variant="ghost" onClick={resetFilters} aria-label="Réinitialiser"><X className="h-4 w-4" /></Button>
        </div>
      </Card>

      {/* Views */}
      {loading && <div className="p-8 text-center text-sm text-muted-foreground">Chargement…</div>}

      {!loading && view === "month" && (
        <MonthView
          days={monthGrid}
          cursor={cursor}
          canWrite={canWrite}
          onDblClickDay={(d) => openNew(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9, 0))}
          onClickEvent={(e) => openQuick(e)}
          onDblClickEvent={(e) => openEdit(e)}
          memberName={memberName}
          chantierName={chantierName}
          clientName={clientName}
          onMoveDay={(targetDay, id) => {
            const evt = events.find((x) => x.id === id);
            if (!evt?.start_at) return;
            const orig = new Date(evt.start_at);
            const next = new Date(targetDay); next.setHours(orig.getHours(), orig.getMinutes(), 0, 0);
            if (sameDay(orig, next)) return;
            let nextEnd: Date | null = null;
            if (evt.end_at) { const d = new Date(evt.end_at); nextEnd = new Date(next.getTime() + (d.getTime() - orig.getTime())); }
            void commitReschedule(id, next, nextEnd);
          }}
          eventsOn={eventsOn}
        />
      )}

      {!loading && (view === "week" || view === "day" || view === "custom") && (
        <TimeGridView
          days={(() => {
            const out: Date[] = [];
            const start = view === "week" ? startOfWeek(cursor) : (view === "day" ? cursor : range.from);
            const total = view === "week" ? 7 : (view === "day" ? 1 : Math.min(31, Math.max(1, Math.round((range.to.getTime() - range.from.getTime())/86400000)+1)));
            for (let i = 0; i < total; i++) out.push(addDays(new Date(start.getFullYear(), start.getMonth(), start.getDate()), i));
            return out;
          })()}
          events={events}
          canWrite={canWrite}
          onCreateRange={(s, e) => openNew(s, e)}
          onClickEvent={(e) => openQuick(e)}
          onDblClickEvent={(e) => openEdit(e)}
          memberName={memberName}
          chantierName={chantierName}
          clientName={clientName}
          onMove={(id, newStart) => {
            const evt = events.find((x) => x.id === id);
            if (!evt?.start_at) return;
            const orig = new Date(evt.start_at);
            const durMs = evt.end_at ? (new Date(evt.end_at).getTime() - orig.getTime()) : 60*60*1000;
            const end = new Date(newStart.getTime() + durMs);
            void commitReschedule(id, newStart, end);
          }}
          onResize={(id, newEnd) => { void commitResize(id, newEnd); }}
        />
      )}

      {!loading && view === "list" && (
        <Card className="p-2">
          {events.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">Aucun événement sur la période.</p>
          ) : (
            <ul className="divide-y divide-border">
              {[...events].sort((a,b) => (new Date(a.start_at ?? 0).getTime() - new Date(b.start_at ?? 0).getTime())).map((e) => {
                const c = colorOf(e);
                const ann = e.status === "annule";
                return (
                  <li key={e.id} className={cn("flex cursor-pointer items-start gap-3 px-2 py-2.5 hover:bg-muted/40", ann && "opacity-60 line-through")} onClick={() => openEdit(e)}>
                    <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c.bg }} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium leading-tight">{e.title}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {e.start_at ? new Date(e.start_at).toLocaleString("fr-FR", { weekday:"short", day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" }) : "—"}
                        {e.chantier && <> · {e.chantier.name}</>}
                        {e.assigned_to && <> · {membersById.get(e.assigned_to)?.name ?? "—"}</>}
                        {e.location && <> · {e.location}</>}
                      </p>
                    </div>
                    <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: c.bg + "22", color: c.bg }}>{TYPE_LABELS[e.event_type] ?? e.event_type}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      {/* Floating + on mobile */}
      {canWrite && (
        <button onClick={() => openNew(new Date())}
          className="fixed bottom-20 right-4 z-30 inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg lg:hidden"
          aria-label="Nouvel événement">
          <Plus className="h-5 w-5" />
        </button>
      )}

      {/* Dialog */}
      <Dialog open={evtOpen} onOpenChange={setEvtOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-primary" />
              {evtForm.id ? "Modifier l'événement" : "Nouvel événement"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={saveEvt} className="space-y-3">
            <Tabs defaultValue="details">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="details">Détails</TabsTrigger>
                <TabsTrigger value="reminder">Rappel</TabsTrigger>
              </TabsList>

              <TabsContent value="details" className="space-y-3 pt-3">
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
                  <div>
                    <Label>Chantier *</Label>
                    <Select value={evtForm.chantier_id} onValueChange={(v) => setEvtForm({ ...evtForm, chantier_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Choisir" /></SelectTrigger>
                      <SelectContent>{chantiers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Client</Label>
                    <Select value={evtForm.client_id || "none"} onValueChange={(v) => setEvtForm({ ...evtForm, client_id: v === "none" ? "" : v })}>
                      <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div>
                  <Label>Assigné à</Label>
                  <Select value={evtForm.assigned_to || "none"} onValueChange={(v) => setEvtForm({ ...evtForm, assigned_to: v === "none" ? "" : v })}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">—</SelectItem>
                      {members.map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center gap-3">
                  <Switch checked={evtForm.all_day} onCheckedChange={(v) => setEvtForm({ ...evtForm, all_day: !!v })} />
                  <span className="text-sm">Journée entière</span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Début</Label><Input type={evtForm.all_day ? "date" : "datetime-local"} value={evtForm.all_day ? evtForm.start_at.slice(0,10) : evtForm.start_at} onChange={(e) => setEvtForm({ ...evtForm, start_at: e.target.value })} /></div>
                  <div><Label>Fin</Label><Input type={evtForm.all_day ? "date" : "datetime-local"} value={evtForm.all_day ? evtForm.end_at.slice(0,10) : evtForm.end_at} onChange={(e) => setEvtForm({ ...evtForm, end_at: e.target.value })} /></div>
                </div>

                <div><Label>Lieu</Label><Input value={evtForm.location} onChange={(e) => setEvtForm({ ...evtForm, location: e.target.value })} /></div>

                <div>
                  <Label>Couleur</Label>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <button type="button" onClick={() => setEvtForm({ ...evtForm, color: "", color_source: "auto" })}
                      className={cn("h-7 rounded-md border px-2 text-xs", !evtForm.color ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground")}>
                      Auto ({TYPE_TO_COLOR[evtForm.event_type] ? COLORS.find(c=>c.key===TYPE_TO_COLOR[evtForm.event_type])?.label : "—"})
                    </button>
                    {COLORS.map((c) => (
                      <button key={c.key} type="button"
                        onClick={() => setEvtForm({ ...evtForm, color: c.key, color_source: "manual" })}
                        className={cn("h-7 w-7 rounded-full border-2 transition", evtForm.color === c.key ? "border-foreground scale-110" : "border-transparent")}
                        style={{ background: c.bg }} title={c.label} aria-label={c.label} />
                    ))}
                  </div>
                </div>

                <div><Label>Description</Label><Textarea rows={3} value={evtForm.description} onChange={(e) => setEvtForm({ ...evtForm, description: e.target.value })} /></div>
              </TabsContent>

              <TabsContent value="reminder" className="space-y-3 pt-3">
                <div>
                  <Label>Rappel programmé</Label>
                  <Input type="datetime-local" value={evtForm.reminder_at} onChange={(e) => setEvtForm({ ...evtForm, reminder_at: e.target.value })} />
                  <p className="mt-1 text-xs text-muted-foreground">Un email sera envoyé à l'assigné à cette date.</p>
                </div>
              </TabsContent>
            </Tabs>

            <DialogFooter className="flex flex-row items-center justify-between gap-2 sm:justify-between">
              <div className="flex gap-1">
                {evtForm.id && isAdmin && (
                  <Button type="button" variant="ghost" size="sm" onClick={removeEvt} className="text-destructive">
                    <Trash2 className="h-4 w-4" /> Supprimer
                  </Button>
                )}
                {evtForm.id && canWrite && (
                  <Button type="button" variant="ghost" size="sm" onClick={duplicateEvt}>
                    <Copy className="h-4 w-4" /> Dupliquer
                  </Button>
                )}
              </div>
              <Button type="submit" className="shadow-brand">{evtForm.id ? "Enregistrer" : "Créer"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Quick edit side panel */}
      {quickEvt && activeCompanyId && (
        <QuickEditSheet
          evt={quickEvt}
          members={members}
          companyId={activeCompanyId}
          canWrite={canWrite}
          updateEvtFn={updateEvtFn}
          deleteEvtFn={deleteEvtFn}
          chantierName={chantierName}
          clientName={clientName}
          onClose={() => setQuickEvt(null)}
          onOpenFull={(e) => { setQuickEvt(null); openEdit(e); }}
          onSaved={() => { setQuickEvt(null); void load(); }}
        />
      )}
    </div>
  );
}

// ============= MONTH VIEW =============
function EventHoverContent({ evt, memberName, chantierName, clientName }: {
  evt: Evt;
  memberName: (id: string | null | undefined) => string | null;
  chantierName: (id: string | null | undefined) => string;
  clientName: (id: string | null | undefined) => string;
}) {
  const c = colorOf(evt);
  const start = evt.start_at ? new Date(evt.start_at) : null;
  const end = evt.end_at ? new Date(evt.end_at) : null;
  const assigned = memberName(evt.assigned_to);
  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-start gap-2">
        <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c.bg }} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold leading-tight">{evt.title}</p>
          <p className="text-[11px] text-muted-foreground">{TYPE_LABELS[evt.event_type] ?? evt.event_type}</p>
        </div>
        <Badge variant="outline" className="capitalize">{evt.status.replace("_", " ")}</Badge>
      </div>
      {start && (
        <p className="text-xs text-muted-foreground">
          {start.toLocaleDateString("fr-FR", { weekday: "long", day: "2-digit", month: "long" })}
          {!evt.all_day && ` · ${fmtTime(start)}${end ? ` – ${fmtTime(end)}` : ""}`}
          {evt.all_day && " · journée entière"}
        </p>
      )}
      {evt.chantier_id && <p className="text-xs"><span className="text-muted-foreground">Chantier :</span> {chantierName(evt.chantier_id)}</p>}
      {evt.client_id && <p className="text-xs"><span className="text-muted-foreground">Client :</span> {clientName(evt.client_id)}</p>}
      {assigned && <p className="text-xs"><span className="text-muted-foreground">Assigné :</span> {assigned}</p>}
      {evt.location && <p className="text-xs"><span className="text-muted-foreground">Lieu :</span> {evt.location}</p>}
      {evt.description && <p className="line-clamp-3 border-t border-border pt-1.5 text-xs text-muted-foreground">{evt.description}</p>}
    </div>
  );
}

function MonthView({
  days, cursor, canWrite, onDblClickDay, onClickEvent, onDblClickEvent, onMoveDay, eventsOn,
  memberName, chantierName, clientName,
}: {
  days: Date[]; cursor: Date; canWrite: boolean;
  onDblClickDay: (d: Date) => void;
  onClickEvent: (e: Evt) => void;
  onDblClickEvent: (e: Evt) => void;
  onMoveDay: (d: Date, id: string) => void;
  eventsOn: (d: Date) => Evt[];
  memberName: (id: string | null | undefined) => string | null;
  chantierName: (id: string | null | undefined) => string;
  clientName: (id: string | null | undefined) => string;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  return (
    <Card className="overflow-hidden p-0">
      <div className="sticky top-0 z-20 grid grid-cols-7 border-b border-border bg-background/95 text-[11px] font-medium uppercase tracking-wide text-muted-foreground backdrop-blur">
        {["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"].map((d) => <div key={d} className="p-2 text-center">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day, i) => {
          const inMonth = day.getMonth() === cursor.getMonth();
          const dayEvts = eventsOn(day);
          const isToday = sameDay(day, new Date());
          const isDropTarget = dragId && dragOverIdx === i;
          return (
            <div key={i}
              onDoubleClick={() => canWrite && onDblClickDay(day)}
              onDragOver={(e) => { if (canWrite && dragId) { e.preventDefault(); if (dragOverIdx !== i) setDragOverIdx(i); } }}
              onDragLeave={() => { if (dragOverIdx === i) setDragOverIdx(null); }}
              onDrop={(e) => { e.preventDefault(); if (canWrite && dragId) { const id = dragId; setDragId(null); setDragOverIdx(null); onMoveDay(day, id); } }}
              className={cn("min-h-[104px] cursor-pointer border-b border-r border-border p-1.5 text-left text-xs transition hover:bg-muted/30",
                !inMonth && "bg-muted/10 text-muted-foreground",
                isDropTarget && "bg-primary/15 ring-2 ring-inset ring-primary/60")}>
              <div className={cn("mb-1 inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold",
                isToday && "bg-primary text-primary-foreground")}>{day.getDate()}</div>
              <div className="space-y-0.5">
                {dayEvts.slice(0, 3).map((e) => {
                  const c = colorOf(e);
                  const isSystem = e.event_type.startsWith("system_");
                  const draggable = canWrite && !isSystem && !!e.start_at;
                  const ann = e.status === "annule";
                  const isDragged = dragId === e.id;
                  return (
                    <HoverCard key={e.id} openDelay={350} closeDelay={80}>
                      <HoverCardTrigger asChild>
                        <div
                          draggable={draggable}
                          onDragStart={() => { if (draggable) setDragId(e.id); }}
                          onDragEnd={() => { setDragId(null); setDragOverIdx(null); }}
                          onClick={(ev) => { ev.stopPropagation(); onClickEvent(e); }}
                          onDoubleClick={(ev) => { ev.stopPropagation(); onDblClickEvent(e); }}
                          className={cn("truncate rounded px-1.5 py-0.5 text-[11px] font-medium", ann && "line-through opacity-60", draggable && "cursor-grab active:cursor-grabbing", isDragged && "opacity-40")}
                          style={{ background: c.bg, color: c.fg }}>
                          {e.start_at && !e.all_day && <span className="mr-1 opacity-90">{fmtTime(new Date(e.start_at))}</span>}
                          {e.title}
                        </div>
                      </HoverCardTrigger>
                      <HoverCardContent side="right" align="start" className="w-72">
                        <EventHoverContent evt={e} memberName={memberName} chantierName={chantierName} clientName={clientName} />
                      </HoverCardContent>
                    </HoverCard>
                  );
                })}
                {dayEvts.length > 3 && <div className="px-1 text-[10px] text-muted-foreground">+ {dayEvts.length - 3} autres</div>}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ============= TIME GRID (week/day/custom) =============
const HOUR_PX = 56;
const START_HOUR = 7;
const END_HOUR = 21;
const TOTAL_HOURS = END_HOUR - START_HOUR;

function fmtMin(min: number) {
  const total = START_HOUR * 60 + min;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

type Positioned = { evt: Evt; dayIdx: number; topMin: number; heightMin: number; col: number; cols: number };

function TimeGridView({
  days, events, canWrite, onCreateRange, onClickEvent, onDblClickEvent, onMove, onResize,
  memberName, chantierName, clientName,
}: {
  days: Date[]; events: Evt[]; canWrite: boolean;
  onCreateRange: (s: Date, e: Date) => void;
  onClickEvent: (e: Evt) => void;
  onDblClickEvent: (e: Evt) => void;
  onMove: (id: string, newStart: Date) => void;
  onResize: (id: string, newEnd: Date) => void;
  memberName: (id: string | null | undefined) => string | null;
  chantierName: (id: string | null | undefined) => string;
  clientName: (id: string | null | undefined) => string;
}) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  type Drag =
    | { kind: "select"; dayIdx: number; startMin: number; endMin: number }
    | { kind: "move"; id: string; offsetMin: number; durationMin: number; dayIdx: number; startMin: number }
    | { kind: "resize"; id: string; dayIdx: number; startMin: number; endMin: number }
    | null;
  const [drag, setDrag] = useState<Drag>(null);
  const dragRef = useRef<Drag>(null);
  useEffect(() => { dragRef.current = drag; }, [drag]);

  // current time
  const [nowMin, setNowMin] = useState(() => {
    const n = new Date(); return (n.getHours() - START_HOUR) * 60 + n.getMinutes();
  });
  useEffect(() => {
    const id = setInterval(() => {
      const n = new Date(); setNowMin((n.getHours() - START_HOUR) * 60 + n.getMinutes());
    }, 60000);
    return () => clearInterval(id);
  }, []);
  const todayIdx = days.findIndex((d) => sameDay(d, new Date()));

  // scroll to ~current time on mount / day change
  useEffect(() => {
    const sc = scrollRef.current; if (!sc) return;
    const target = Math.max(0, (nowMin / 60) * HOUR_PX - 120);
    sc.scrollTop = target;
    // only once per day-set change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days.length, days[0]?.toDateString()]);

  function pointerToCell(clientX: number, clientY: number) {
    const grid = gridRef.current; if (!grid) return null;
    const rect = grid.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const dayIdx = Math.max(0, Math.min(days.length - 1, Math.floor((x / rect.width) * days.length)));
    const minutes = Math.max(0, Math.min(TOTAL_HOURS * 60, Math.round((y / (TOTAL_HOURS * HOUR_PX)) * TOTAL_HOURS * 60 / 15) * 15));
    return { dayIdx, minutes };
  }
  function minutesToDate(day: Date, minutes: number) {
    const d = new Date(day.getFullYear(), day.getMonth(), day.getDate(), START_HOUR, 0, 0);
    d.setMinutes(minutes);
    return d;
  }

  function onMouseDownBg(e: React.MouseEvent) {
    if (!canWrite) return;
    if ((e.target as HTMLElement).closest("[data-evt]")) return;
    const p = pointerToCell(e.clientX, e.clientY); if (!p) return;
    setDrag({ kind: "select", dayIdx: p.dayIdx, startMin: p.minutes, endMin: p.minutes + 60 });
  }
  function onMouseDownEvent(e: React.MouseEvent, evt: Evt, dayIdx: number, startMin: number, endMin: number) {
    if (!canWrite || evt.event_type.startsWith("system_")) return;
    e.stopPropagation(); e.preventDefault();
    const p = pointerToCell(e.clientX, e.clientY); if (!p) return;
    setDrag({ kind: "move", id: evt.id, offsetMin: p.minutes - startMin, durationMin: endMin - startMin, dayIdx, startMin });
  }
  function onMouseDownResize(e: React.MouseEvent, evt: Evt, dayIdx: number, startMin: number, endMin: number) {
    if (!canWrite || evt.event_type.startsWith("system_")) return;
    e.stopPropagation(); e.preventDefault();
    setDrag({ kind: "resize", id: evt.id, dayIdx, startMin, endMin });
  }

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      const d = dragRef.current; if (!d) return;
      const p = pointerToCell(e.clientX, e.clientY); if (!p) return;
      if (d.kind === "select") setDrag({ ...d, dayIdx: p.dayIdx, endMin: Math.max(d.startMin + 15, p.minutes) });
      else if (d.kind === "move") setDrag({ ...d, dayIdx: p.dayIdx, startMin: Math.max(0, Math.min(TOTAL_HOURS * 60 - d.durationMin, p.minutes - d.offsetMin)) });
      else if (d.kind === "resize") setDrag({ ...d, endMin: Math.max(d.startMin + 15, p.minutes) });

      // auto-scroll
      const sc = scrollRef.current;
      if (sc) {
        const rect = sc.getBoundingClientRect();
        const edge = 50;
        if (e.clientY < rect.top + edge) sc.scrollTop -= Math.max(4, (rect.top + edge - e.clientY) / 3);
        else if (e.clientY > rect.bottom - edge) sc.scrollTop += Math.max(4, (e.clientY - (rect.bottom - edge)) / 3);
      }
    }
    function onUp() {
      const d = dragRef.current; if (!d) return;
      setDrag(null);
      if (d.kind === "select") {
        const day = days[d.dayIdx];
        const s = minutesToDate(day, Math.min(d.startMin, d.endMin));
        const en = minutesToDate(day, Math.max(d.startMin, d.endMin));
        if (en.getTime() - s.getTime() >= 15 * 60000) onCreateRange(s, en);
      } else if (d.kind === "move") {
        const day = days[d.dayIdx]; onMove(d.id, minutesToDate(day, d.startMin));
      } else if (d.kind === "resize") {
        const day = days[d.dayIdx]; onResize(d.id, minutesToDate(day, d.endMin));
      }
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMouseMove); window.removeEventListener("mouseup", onUp); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, onMove, onResize, onCreateRange]);

  // Base positions with side-by-side overlap layout
  const positioned = useMemo<Positioned[]>(() => {
    const byDay: { evt: Evt; dayIdx: number; topMin: number; heightMin: number }[][] = days.map(() => []);
    for (const e of events) {
      if (!e.start_at) continue;
      const s = new Date(e.start_at);
      const en = e.end_at ? new Date(e.end_at) : new Date(s.getTime() + 60 * 60000);
      for (let i = 0; i < days.length; i++) {
        if (sameDay(s, days[i])) {
          const startMin = (s.getHours() - START_HOUR) * 60 + s.getMinutes();
          const endMin = (en.getHours() - START_HOUR) * 60 + en.getMinutes();
          byDay[i].push({ evt: e, dayIdx: i, topMin: Math.max(0, startMin), heightMin: Math.max(20, endMin - startMin) });
          break;
        }
      }
    }
    const out: Positioned[] = [];
    for (const dayItems of byDay) {
      dayItems.sort((a, b) => a.topMin - b.topMin || b.heightMin - a.heightMin);
      // greedy column assignment
      const cols: { end: number }[] = [];
      const assigned: { item: typeof dayItems[number]; col: number }[] = [];
      for (const it of dayItems) {
        let col = cols.findIndex((c) => c.end <= it.topMin);
        if (col === -1) { col = cols.length; cols.push({ end: it.topMin + it.heightMin }); }
        else cols[col].end = it.topMin + it.heightMin;
        assigned.push({ item: it, col });
      }
      // determine cluster size: events overlapping in time share total columns
      // simpler: total cols = max columns used in any overlap chain
      // compute per-event the max cols among the events it overlaps
      for (const a of assigned) {
        let maxCols = a.col + 1;
        for (const b of assigned) {
          const oa = a.item, ob = b.item;
          if (oa === ob) continue;
          const overlap = oa.topMin < ob.topMin + ob.heightMin && ob.topMin < oa.topMin + oa.heightMin;
          if (overlap) maxCols = Math.max(maxCols, b.col + 1);
        }
        out.push({ ...a.item, col: a.col, cols: maxCols });
      }
    }
    return out;
  }, [events, days]);

  const colWidthPct = 100 / days.length;

  // Tooltip / floating times during drag
  const dragTooltip = (() => {
    if (!drag) return null;
    if (drag.kind === "select") return { day: days[drag.dayIdx], s: Math.min(drag.startMin, drag.endMin), e: Math.max(drag.startMin, drag.endMin) };
    if (drag.kind === "move") return { day: days[drag.dayIdx], s: drag.startMin, e: drag.startMin + drag.durationMin };
    return { day: days[drag.dayIdx], s: drag.startMin, e: drag.endMin };
  })();

  return (
    <Card className="overflow-hidden p-0">
      {/* Header */}
      <div className="sticky top-0 z-30 grid border-b border-border bg-background/95 backdrop-blur" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0,1fr))` }}>
        <div />
        {days.map((d, i) => {
          const isToday = sameDay(d, new Date());
          return (
            <div key={i} className="border-l border-border px-2 py-2 text-center text-xs">
              <div className="uppercase tracking-wide text-muted-foreground">{d.toLocaleDateString("fr-FR", { weekday: "short" })}</div>
              <div className={cn("mx-auto mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold", isToday && "bg-primary text-primary-foreground")}>{d.getDate()}</div>
            </div>
          );
        })}
      </div>

      {/* Body */}
      <div ref={scrollRef} className="relative overflow-auto" style={{ maxHeight: "72vh" }}>
        <div className="grid" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0,1fr))` }}>
          {/* Hours col (sticky left) */}
          <div className="sticky left-0 z-10 bg-background" style={{ height: TOTAL_HOURS * HOUR_PX }}>
            {Array.from({ length: TOTAL_HOURS + 1 }).map((_, h) => (
              <div key={h} className="absolute left-0 right-0 -translate-y-2 pr-1 text-right text-[10px] font-medium text-muted-foreground" style={{ top: h * HOUR_PX }}>
                {String(START_HOUR + h).padStart(2, "0")}:00
              </div>
            ))}
          </div>
          {/* Day columns */}
          <div ref={gridRef} onMouseDown={onMouseDownBg}
            onDoubleClick={(e) => {
              if (!canWrite) return;
              if ((e.target as HTMLElement).closest("[data-evt]")) return;
              const p = pointerToCell(e.clientX, e.clientY); if (!p) return;
              const s = minutesToDate(days[p.dayIdx], p.minutes);
              onCreateRange(s, new Date(s.getTime() + 60 * 60000));
            }}
            className={cn("relative col-span-full -ml-px", drag?.kind === "move" && "cursor-grabbing select-none", drag?.kind === "resize" && "cursor-ns-resize select-none")}
            style={{ gridColumn: `2 / span ${days.length}`, height: TOTAL_HOURS * HOUR_PX, gridTemplateColumns: `repeat(${days.length}, minmax(0,1fr))`, display: "grid" }}>
            {days.map((d, i) => (
              <div key={i} className={cn("relative border-l border-border", i === todayIdx && "bg-primary/[0.04]")}>
                {/* Hour lines */}
                {Array.from({ length: TOTAL_HOURS }).map((_, h) => (
                  <div key={h} className="absolute left-0 right-0 border-t border-border/50" style={{ top: h * HOUR_PX }} />
                ))}
                {/* Half-hour subtle */}
                {Array.from({ length: TOTAL_HOURS }).map((_, h) => (
                  <div key={"h" + h} className="absolute left-0 right-0 border-t border-dashed border-border/20" style={{ top: h * HOUR_PX + HOUR_PX / 2 }} />
                ))}
              </div>
            ))}

            {/* Current time indicator */}
            {todayIdx >= 0 && nowMin >= 0 && nowMin <= TOTAL_HOURS * 60 && (
              <div className="pointer-events-none absolute z-20" style={{
                top: (nowMin / 60) * HOUR_PX - 1,
                left: `${todayIdx * colWidthPct}%`,
                width: `${colWidthPct}%`,
              }}>
                <div className="relative h-0.5 bg-red-500">
                  <div className="absolute -left-1 -top-[5px] h-3 w-3 rounded-full bg-red-500 shadow" />
                </div>
              </div>
            )}

            {/* Events overlay */}
            {positioned.map((p) => {
              const { evt, dayIdx, topMin, heightMin, col, cols } = p;
              const c = colorOf(evt);
              const ann = evt.status === "annule";
              const isSystem = evt.event_type.startsWith("system_");
              const isDragged = drag && "id" in drag && drag.id === evt.id;

              // Live position override
              let liveDayIdx = dayIdx;
              let liveTop = topMin;
              let liveHeight = heightMin;
              if (isDragged && drag?.kind === "move") {
                liveDayIdx = drag.dayIdx;
                liveTop = drag.startMin;
                liveHeight = drag.durationMin;
              } else if (isDragged && drag?.kind === "resize") {
                liveHeight = Math.max(15, drag.endMin - drag.startMin);
              }

              const subW = (colWidthPct / cols);
              const left = `calc(${liveDayIdx * colWidthPct + col * subW}% + 2px)`;
              const width = `calc(${subW}% - 4px)`;

              return (
                <HoverCard key={evt.id} openDelay={400} closeDelay={80}>
                  <HoverCardTrigger asChild>
                    <div data-evt
                      onMouseDown={(e) => onMouseDownEvent(e, evt, dayIdx, topMin, topMin + heightMin)}
                      onClick={(e) => { e.stopPropagation(); if (!isDragged) onClickEvent(evt); }}
                      onDoubleClick={(e) => { e.stopPropagation(); onDblClickEvent(evt); }}
                      className={cn(
                        "absolute overflow-hidden rounded-md px-1.5 py-1 text-[11px] font-medium shadow-sm transition-shadow hover:brightness-105 hover:shadow-md",
                        !isSystem && canWrite && "cursor-grab active:cursor-grabbing",
                        ann && "line-through opacity-60",
                        isDragged && "z-30 scale-[1.02] shadow-2xl ring-2 ring-white",
                      )}
                      style={{
                        background: c.bg, color: c.fg,
                        left, width,
                        top: (liveTop / 60) * HOUR_PX,
                        height: (liveHeight / 60) * HOUR_PX - 2,
                        zIndex: isDragged ? 40 : 10,
                      }}>
                      <div className="truncate">{evt.title}</div>
                      {liveHeight >= 30 && (
                        <div className="truncate text-[10px] opacity-90">
                          {fmtMin(liveTop)} – {fmtMin(liveTop + liveHeight)}
                        </div>
                      )}
                      {/* resize handle */}
                      {!isSystem && canWrite && (
                        <div onMouseDown={(e) => onMouseDownResize(e, evt, dayIdx, topMin, topMin + heightMin)}
                          className="absolute inset-x-1 bottom-0 h-1.5 cursor-ns-resize rounded-b bg-white/30 opacity-0 transition-opacity hover:opacity-100 group-hover:opacity-100"
                          style={{ opacity: isDragged ? 1 : undefined }}
                        />
                      )}
                    </div>
                  </HoverCardTrigger>
                  {!drag && (
                    <HoverCardContent side="right" align="start" className="w-72">
                      <EventHoverContent evt={evt} memberName={memberName} chantierName={chantierName} clientName={clientName} />
                    </HoverCardContent>
                  )}
                </HoverCard>
              );
            })}

            {/* Ghost selection */}
            {drag?.kind === "select" && (
              <div className="pointer-events-none absolute z-20 rounded-md border-2 border-primary/60 bg-primary/20"
                style={{
                  left: `calc(${drag.dayIdx * colWidthPct}% + 2px)`,
                  width: `calc(${colWidthPct}% - 4px)`,
                  top: (Math.min(drag.startMin, drag.endMin) / 60) * HOUR_PX,
                  height: (Math.abs(drag.endMin - drag.startMin) / 60) * HOUR_PX,
                }} />
            )}

            {/* Drag snap line + tooltip */}
            {dragTooltip && (
              <>
                <div className="pointer-events-none absolute left-0 right-0 z-30 border-t-2 border-dashed border-primary/70"
                  style={{ top: (dragTooltip.s / 60) * HOUR_PX }} />
                <div className="pointer-events-none absolute z-40 rounded-md bg-foreground px-2 py-1 text-[11px] font-semibold text-background shadow-lg"
                  style={{
                    left: `calc(${dragTooltip.day ? days.indexOf(dragTooltip.day) * colWidthPct : 0}% + 4px)`,
                    top: (dragTooltip.s / 60) * HOUR_PX - 26,
                  }}>
                  {fmtMin(dragTooltip.s)} – {fmtMin(dragTooltip.e)}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

// ============= QUICK EDIT SHEET =============
function QuickEditSheet({
  evt, members, companyId, canWrite, updateEvtFn, deleteEvtFn,
  chantierName, clientName, onClose, onOpenFull, onSaved,
}: {
  evt: Evt;
  members: { user_id: string; name: string }[];
  companyId: string;
  canWrite: boolean;
  updateEvtFn: (a: { data: { companyId: string; id: string; data: Record<string, unknown> } }) => Promise<unknown>;
  deleteEvtFn: (a: { data: { companyId: string; id: string } }) => Promise<unknown>;
  chantierName: (id: string | null | undefined) => string;
  clientName: (id: string | null | undefined) => string;
  onClose: () => void;
  onOpenFull: (e: Evt) => void;
  onSaved: () => void;
}) {
  const [start, setStart] = useState(evt.start_at ? toLocalInput(new Date(evt.start_at)) : "");
  const [end, setEnd] = useState(evt.end_at ? toLocalInput(new Date(evt.end_at)) : "");
  const [status, setStatus] = useState(evt.status);
  const [color, setColor] = useState<ColorKey | "">(((evt.color && COLORS.some((c) => c.key === evt.color)) ? evt.color : "") as ColorKey | "");
  const [assigned, setAssigned] = useState(evt.assigned_to ?? "");
  const [saving, setSaving] = useState(false);
  const isSystem = evt.event_type.startsWith("system_");
  const readOnly = !canWrite || isSystem;

  async function save() {
    if (readOnly) return;
    setSaving(true);
    try {
      await updateEvtFn({ data: { companyId, id: evt.id, data: {
        title: evt.title,
        description: evt.description ?? "",
        event_type: evt.event_type,
        status: status as "prevu",
        start_at: start ? new Date(start).toISOString() : null,
        end_at: end ? new Date(end).toISOString() : null,
        all_day: evt.all_day ?? false,
        assigned_to: assigned || null,
        client_id: evt.client_id ?? null,
        reminder_at: evt.reminder_at ?? null,
        location: evt.location ?? "",
        color: color || "",
        color_source: color ? "manual" : "auto",
      } } });
      toast.success("Événement mis à jour");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Échec");
    } finally { setSaving(false); }
  }

  async function remove() {
    if (readOnly) return;
    if (!confirm("Supprimer cet événement ?")) return;
    try {
      await deleteEvtFn({ data: { companyId, id: evt.id } });
      toast.success("Supprimé");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Suppression impossible");
    }
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full" style={{ background: colorOf(evt).bg }} />
            <span className="truncate">{evt.title}</span>
          </SheetTitle>
          <p className="text-xs text-muted-foreground">
            {TYPE_LABELS[evt.event_type] ?? evt.event_type}
            {evt.chantier_id && ` · ${chantierName(evt.chantier_id)}`}
            {evt.client_id && ` · ${clientName(evt.client_id)}`}
          </p>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Début</Label>
              <Input type={evt.all_day ? "date" : "datetime-local"} value={evt.all_day ? start.slice(0, 10) : start}
                onChange={(e) => setStart(e.target.value)} disabled={readOnly} />
            </div>
            <div>
              <Label className="text-xs">Fin</Label>
              <Input type={evt.all_day ? "date" : "datetime-local"} value={evt.all_day ? end.slice(0, 10) : end}
                onChange={(e) => setEnd(e.target.value)} disabled={readOnly} />
            </div>
          </div>

          <div>
            <Label className="text-xs">Statut</Label>
            <Select value={status} onValueChange={setStatus} disabled={readOnly}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="prevu">Prévu</SelectItem>
                <SelectItem value="en_cours">En cours</SelectItem>
                <SelectItem value="termine">Terminé</SelectItem>
                <SelectItem value="annule">Annulé</SelectItem>
                <SelectItem value="reporte">Reporté</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Assigné à</Label>
            <Select value={assigned || "none"} onValueChange={(v) => setAssigned(v === "none" ? "" : v)} disabled={readOnly}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                {members.map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Couleur</Label>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <button type="button" disabled={readOnly} onClick={() => setColor("")}
                className={cn("h-7 rounded-md border px-2 text-xs", !color ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground")}>
                Auto
              </button>
              {COLORS.map((c) => (
                <button key={c.key} type="button" disabled={readOnly}
                  onClick={() => setColor(c.key)}
                  className={cn("h-7 w-7 rounded-full border-2 transition", color === c.key ? "border-foreground scale-110" : "border-transparent")}
                  style={{ background: c.bg }} title={c.label} aria-label={c.label} />
              ))}
            </div>
          </div>

          <Button type="button" variant="outline" size="sm" onClick={() => onOpenFull(evt)} className="w-full">
            <Pencil className="h-4 w-4" /> Tout modifier (formulaire complet)
          </Button>
        </div>

        <SheetFooter className="mt-6 flex-row justify-between gap-2 sm:flex-row sm:justify-between">
          {!readOnly && (
            <Button type="button" variant="ghost" size="sm" onClick={remove} className="text-destructive">
              <Trash2 className="h-4 w-4" /> Supprimer
            </Button>
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Annuler</Button>
            <Button type="button" onClick={save} disabled={readOnly || saving} className="shadow-brand">
              {saving ? "…" : "Enregistrer"}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

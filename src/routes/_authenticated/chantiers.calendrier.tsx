import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Plus, X, Trash2, Copy, CalendarDays, Search, Pencil, AlertTriangle, Users, Maximize2, Minimize2, CheckCircle2, Clock, Filter, ZoomIn, Eye } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";

import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/app/PageHeader";
import { useCompany } from "@/hooks/use-company";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import {
  listChantierEvents, createChantierEvent, updateChantierEvent, deleteChantierEvent,
  listCompanyMembers, rescheduleChantierEvent, resizeChantierEvent, duplicateChantierEvent,
  reassignChantierEvent, detectChantierEventConflicts, logChantierEventConflictOverride,
} from "@/lib/chantier-detail.functions";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";

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
  chantier?: { id: string; name: string; color?: string | null } | null;
  client?: { id: string; name: string } | null;
};

// ----- Palette métier (PVIA) — règle unique : même type = même couleur partout -----
const COLORS = [
  { key: "blue",   label: "Bleu (Procès-verbal)",     bg: "#2563eb", fg: "#ffffff" },
  { key: "green",  label: "Vert (Réception)",         bg: "#10b981", fg: "#ffffff" },
  { key: "yellow", label: "Jaune (Intervention)",     bg: "#eab308", fg: "#1f2937" },
  { key: "orange", label: "Orange (Réserve)",         bg: "#f97316", fg: "#ffffff" },
  { key: "red",    label: "Rouge (SAV)",              bg: "#ef4444", fg: "#ffffff" },
  { key: "black",  label: "Noir (Bloquant / Retard)", bg: "#1f2937", fg: "#ffffff" },
  { key: "purple", label: "Violet (Administratif)",   bg: "#8b5cf6", fg: "#ffffff" },
  { key: "sky",    label: "Bleu clair",               bg: "#0ea5e9", fg: "#ffffff" },
  { key: "gray",   label: "Gris",                     bg: "#6b7280", fg: "#ffffff" },
  { key: "slate",  label: "Gris foncé",               bg: "#334155", fg: "#ffffff" },
] as const;
type ColorKey = typeof COLORS[number]["key"];

// Mapping métier — chaque type d'événement => 1 catégorie couleur.
const TYPE_TO_COLOR: Record<string, ColorKey> = {
  // 🟦 Procès-verbal
  system_pv_created: "blue", system_pv_signed: "blue",
  // 🟩 Réception
  reception: "green", debut_travaux: "green",
  // 🟨 Intervention / pose / visite / contrôle / livraison
  intervention: "yellow", pose: "yellow", visite_technique: "yellow",
  controle_qualite: "yellow", livraison_materiel: "yellow",
  // 🟧 Réserve
  system_reserve_created: "orange", system_reserve_lifted: "orange",
  // 🟥 SAV
  sav: "red",
  // ⬛ Bloquant / retard
  retard: "black",
  // 🟪 Administratif
  rappel: "purple", appel_client: "purple", remarque: "purple",
};
const TYPE_LABELS: Record<string, string> = {
  visite_technique: "Visite technique", intervention: "Intervention", pose: "Pose",
  livraison_materiel: "Livraison matériel", controle_qualite: "Contrôle",
  reception: "Réception", sav: "SAV", appel_client: "Appel client",
  rappel: "Rappel administratif", debut_travaux: "Début travaux",
  retard: "Retard", remarque: "Remarque",
};
type ColorMode = "type" | "chantier";
let CURRENT_COLOR_MODE: ColorMode = "type";
function hexToFg(hex: string): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return "#ffffff";
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 >= 140 ? "#1f2937" : "#ffffff";
}
function colorOf(e: Evt, mode: ColorMode = CURRENT_COLOR_MODE): { bg: string; fg: string; key: ColorKey } {
  if (e.color && COLORS.some((c) => c.key === e.color)) {
    const c = COLORS.find((cc) => cc.key === e.color)!;
    return { bg: c.bg, fg: c.fg, key: e.color as ColorKey };
  }
  if (mode === "chantier" && e.chantier?.color && /^#[0-9a-f]{6}$/i.test(e.chantier.color)) {
    return { bg: e.chantier.color, fg: hexToFg(e.chantier.color), key: "blue" };
  }
  const k: ColorKey = TYPE_TO_COLOR[e.event_type] ?? "purple";
  const c = COLORS.find((cc) => cc.key === k)!;
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

type ViewKind = "month" | "week" | "day" | "custom" | "team";
type TeamMode = "day" | "week";

const UNASSIGNED = "__unassigned__";

const ZOOM_LEVELS = { compact: 44, normal: 56, confort: 72 } as const;
type Zoom = keyof typeof ZOOM_LEVELS;
type WeekDays = 3 | 5 | 6 | 7;

const LS = {
  fs: "pvia.cal.fullscreen",
  zoom: "pvia.cal.zoom",
  weekDays: "pvia.cal.weekDays",
  filtersOpen: "pvia.cal.filtersOpen",
  defaultView: "pvia.cal.defaultView",
};
function lsGet<T>(k: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try { const v = window.localStorage.getItem(k); return v == null ? fallback : (JSON.parse(v) as T); } catch { return fallback; }
}
function lsSet(k: string, v: unknown) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ }
}

// Saved default view preference: which view to open the calendar on.
// "week3" = 3-day view anchored on cursor (mobile field view).
type DefaultViewPref = "day" | "week3" | "week" | "month";
function loadInitialView(isMobile: boolean): { view: ViewKind; weekDays: WeekDays | null } {
  const saved = lsGet<DefaultViewPref | "week5" | null>(LS.defaultView, null);
  if (saved === "day") return { view: "day", weekDays: null };
  if (saved === "week3") return { view: "week", weekDays: 3 };
  if (saved === "week") return { view: "week", weekDays: 7 };
  if (saved === "week5") return { view: "week", weekDays: 7 }; // legacy migration
  if (saved === "month") return { view: "month", weekDays: null };
  return { view: isMobile ? "day" : "month", weekDays: null };
}


function statusIcon(status: string) {
  if (status === "termine") return <CheckCircle2 className="h-3 w-3 shrink-0" />;
  if (status === "reporte") return <Clock className="h-3 w-3 shrink-0" />;
  return null;
}
function initials(name: string | null | undefined) {
  if (!name) return "";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("");
}

function ChantierCalendarPage() {
  const { activeCompanyId, can } = useCompany();
  const canWrite = can("manage");
  const isAdmin = can("admin");
  const isMobile = useIsMobile();
  
  const initial = useMemo(() => loadInitialView(isMobile), [isMobile]);
  const [view, setView] = useState<ViewKind>(initial.view);
  const [cursor, setCursor] = useState(new Date());


  const [customStart, setCustomStart] = useState(() => toLocalInput(new Date()).slice(0,10));
  const [customEnd, setCustomEnd] = useState(() => toLocalInput(addDays(new Date(), 4)).slice(0,10));
  const [events, setEvents] = useState<Evt[]>([]);
  const [loading, setLoading] = useState(true);

  const [chantiers, setChantiers] = useState<{ id: string; name: string; color?: string | null }[]>([]);
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
  const [colorMode, setColorMode] = useState<ColorMode>("type");

  // P4 prefs
  const [fullscreen, setFullscreen] = useState<boolean>(() => lsGet(LS.fs, false));
  const [zoom, setZoom] = useState<Zoom>(() => lsGet<Zoom>(LS.zoom, "normal"));
  const [weekDays, setWeekDays] = useState<WeekDays>(() => (initial.weekDays ?? lsGet<WeekDays>(LS.weekDays, 7)));
  const [filtersOpen, setFiltersOpen] = useState<boolean>(() => lsGet(LS.filtersOpen, false));
  const hourPx = ZOOM_LEVELS[zoom];

  useEffect(() => { lsSet(LS.fs, fullscreen); }, [fullscreen]);
  useEffect(() => { lsSet(LS.zoom, zoom); }, [zoom]);
  useEffect(() => { lsSet(LS.weekDays, weekDays); }, [weekDays]);
  useEffect(() => { lsSet(LS.filtersOpen, filtersOpen); }, [filtersOpen]);

  // Persist the chosen view as the user's default ("Vue par défaut").
  // Only day / week / week3 / month are saved; team / custom are session-only.
  useEffect(() => {
    let pref: DefaultViewPref | null = null;
    if (view === "day") pref = "day";
    else if (view === "month") pref = "month";
    else if (view === "week") pref = weekDays === 3 ? "week3" : "week";
    if (pref) lsSet(LS.defaultView, pref);
  }, [view, weekDays]);

  function applyDefaultViewPreset(p: DefaultViewPref) {
    if (p === "day") { setView("day"); }
    else if (p === "month") { setView("month"); }
    else if (p === "week") { setView("week"); setWeekDays(7); }
    else if (p === "week3") { setView("week"); setWeekDays(3); }
  }


  // Conflict UI state
  type ConflictRow = { id: string; title: string; start_at: string | null; end_at: string | null };
  const [confirmConflicts, setConfirmConflicts] = useState<{ list: ConflictRow[]; proceed: () => Promise<void> | void } | null>(null);
  const [conflictsPanelOpen, setConflictsPanelOpen] = useState(false);

  const fetchEvents = useServerFn(listChantierEvents);
  const createEvtFn = useServerFn(createChantierEvent);
  const updateEvtFn = useServerFn(updateChantierEvent);
  const deleteEvtFn = useServerFn(deleteChantierEvent);
  const reassignFn = useServerFn(reassignChantierEvent);
  const fetchMembers = useServerFn(listCompanyMembers);
  const rescheduleFn = useServerFn(rescheduleChantierEvent);
  const resizeFn = useServerFn(resizeChantierEvent);
  const duplicateFn = useServerFn(duplicateChantierEvent);
 const detectConflictsFn = useServerFn(detectChantierEventConflicts);
 const logConflictOverrideFn = useServerFn(logChantierEventConflictOverride);
  const membersById = useMemo(() => new Map(members.map((m) => [m.user_id, m])), [members]);

  const range = useMemo(() => {
    if (view === "month") return { from: startOfWeek(startOfMonth(cursor)), to: addDays(startOfWeek(endOfMonth(cursor)), 41) };
    if (view === "week") {
      if (weekDays === 3) {
        const d = new Date(cursor); d.setHours(0,0,0,0);
        return { from: d, to: addDays(d, 2) };
      }
      return { from: startOfWeek(cursor), to: addDays(startOfWeek(cursor), weekDays - 1) };
    }
    if (view === "day") { const d = new Date(cursor); d.setHours(0,0,0,0); return { from: d, to: d }; }
    if (view === "team") {
      if (teamMode === "day") { const d = new Date(cursor); d.setHours(0,0,0,0); return { from: d, to: d }; }
      return { from: startOfWeek(cursor), to: addDays(startOfWeek(cursor), (weekDays === 3 ? 7 : weekDays) - 1) };
    }
    if (view === "custom") {
      const a = new Date(customStart + "T00:00:00");
      const b = new Date(customEnd + "T00:00:00");
      return { from: a, to: b >= a ? b : a };
    }
    return { from: startOfMonth(cursor), to: endOfMonth(cursor) };
  }, [cursor, view, customStart, customEnd, teamMode, weekDays]);

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
      if (fOnlyUnassigned) list = list.filter((e) => !e.assigned_to);
      if (fHideDone) list = list.filter((e) => e.status !== "termine");
      if (fHideCancelled) list = list.filter((e) => e.status !== "annule");
      setEvents(list);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Chargement impossible");
    } finally { setLoading(false); }
  }, [activeCompanyId, fetchEvents, range.from, range.to, fChantier, fClient, fType, fStatus, fAssigned, fColor, fOnlyUnassigned, fHideDone, fHideCancelled]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!activeCompanyId) return;
    void (async () => {
      const [c1, c2, c3] = await Promise.all([
        supabase.from("chantiers").select("id,name,color").eq("company_id", activeCompanyId).order("name"),
        supabase.from("clients").select("id,name").eq("company_id", activeCompanyId).order("name"),
        supabase.from("company_settings").select("calendar_color_mode").eq("company_id", activeCompanyId).maybeSingle(),
      ]);
      setChantiers((c1.data as { id: string; name: string; color?: string | null }[]) ?? []);
      setClients((c2.data as { id: string; name: string }[]) ?? []);
      const mode = (c3.data as { calendar_color_mode?: string } | null)?.calendar_color_mode;
      if (mode === "type" || mode === "chantier") setColorMode(mode);
      try {
        const r = await fetchMembers({ data: { companyId: activeCompanyId } });
        setMembers(r.members);
      } catch { /* non-blocking */ }
    })();
  }, [activeCompanyId, fetchMembers]);

  async function persistColorMode(next: ColorMode) {
    if (!activeCompanyId) return;
    setColorMode(next);
    const { error } = await supabase
      .from("company_settings")
      .upsert({ company_id: activeCompanyId, calendar_color_mode: next }, { onConflict: "company_id" });
    if (error) toast.error("Réglage non enregistré (droits admin requis ?)");
    else toast.success(next === "chantier" ? "Couleurs par chantier" : "Couleurs par type");
  }

  // Sync the active color mode into the module-level variable so subcomponents
  // (TimeGridView, MonthView, TeamView…) that call `colorOf` pick it up.
  useEffect(() => { CURRENT_COLOR_MODE = colorMode; }, [colorMode]);

  function resetFilters() {
    setFChantier("all"); setFClient("all"); setFType("all"); setFStatus("all"); setFAssigned("all"); setFColor("all");
    setFOnlyUnassigned(false); setFHideDone(false); setFHideCancelled(false);
  }

  // ----- Conflict detection (per assigned member, in current event list) -----
  const { ids: conflicts, pairs: conflictPairs } = useMemo(() => {
    const ids = new Set<string>();
    const pairs: { member: string | null; a: Evt; b: Evt }[] = [];
    const byMember = new Map<string, Evt[]>();
    for (const e of events) {
      if (!e.assigned_to || !e.start_at || e.status === "annule") continue;
      if (e.event_type.startsWith("system_")) continue;
      const arr = byMember.get(e.assigned_to) ?? [];
      arr.push(e);
      byMember.set(e.assigned_to, arr);
    }
    for (const [member, arr] of byMember.entries()) {
      const sorted = arr.slice().sort((a, b) => new Date(a.start_at!).getTime() - new Date(b.start_at!).getTime());
      for (let i = 0; i < sorted.length; i++) {
        const a = sorted[i];
        const aS = new Date(a.start_at!).getTime();
        const aE = a.end_at ? new Date(a.end_at).getTime() : aS + 60 * 60000;
        for (let j = i + 1; j < sorted.length; j++) {
          const b = sorted[j];
          const bS = new Date(b.start_at!).getTime();
          if (bS >= aE) break;
          const bE = b.end_at ? new Date(b.end_at).getTime() : bS + 60 * 60000;
          if (bS < aE && aS < bE) { ids.add(a.id); ids.add(b.id); pairs.push({ member, a, b }); }
        }
      }
    }
    return { ids, pairs };
  }, [events]);

  // Active filter count
  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (fChantier !== "all") n++;
    if (fClient !== "all") n++;
    if (fType !== "all") n++;
    if (fStatus !== "all") n++;
    if (fAssigned !== "all") n++;
    if (fColor !== "all") n++;
    if (fOnlyUnassigned) n++;
    if (fHideDone) n++;
    if (fHideCancelled) n++;
    return n;
  }, [fChantier, fClient, fType, fStatus, fAssigned, fColor, fOnlyUnassigned, fHideDone, fHideCancelled]);


  // ----- Reassign (team drag) -----
  async function commitReassign(id: string, assignedTo: string | null) {
    if (!activeCompanyId) return;
    try {
      await reassignFn({ data: { companyId: activeCompanyId, id, assigned_to: assignedTo } });
      toast.success(assignedTo ? "Événement réassigné" : "Événement désassigné");
      await load();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Réassignation impossible"); await load(); }
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
  const [clusterSheet, setClusterSheet] = useState<Evt[] | null>(null);
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

  async function persistEvt(payload: Record<string, unknown>) {
    if (!activeCompanyId || !evtForm.chantier_id) return;
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
    // Pre-save conflict detection (when assigned + dated + not cancelled)
    if (evtForm.assigned_to && payload.start_at && payload.end_at && evtForm.status !== "annule") {
      try {
        const r = await detectConflictsFn({ data: {
          companyId: activeCompanyId,
          assigned_to: evtForm.assigned_to,
          start_at: payload.start_at,
          end_at: payload.end_at,
          excludeId: evtForm.id ?? null,
        } });
        if (r.conflicts.length > 0) {
          setConfirmConflicts({
            list: r.conflicts as ConflictRow[],
            proceed: async () => {
              setConfirmConflicts(null);
              await persistEvt(payload);
              try {
                await logConflictOverrideFn({ data: {
                  companyId: activeCompanyId,
                  eventId: evtForm.id ?? null,
                  conflictingEventIds: r.conflicts.map((c) => c.id),
                  startAt: payload.start_at!,
                  endAt: payload.end_at!,
                  assignedTo: evtForm.assigned_to ?? null,
                } });
              } catch { /* non-blocking audit */ }
            },
          });
          return;
        }
      } catch { /* non-blocking */ }
    }
    await persistEvt(payload);
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
    else if (view === "week") setCursor(addDays(cursor, (weekDays === 3 ? 3 : 7) * dir));
    else if (view === "day") setCursor(addDays(cursor, dir));
    else if (view === "team") setCursor(addDays(cursor, teamMode === "day" ? dir : 7 * dir));
    else if (view === "custom") {
      const days = Math.max(1, Math.round((new Date(customEnd).getTime() - new Date(customStart).getTime()) / 86400000) + 1);
      setCustomStart(toLocalInput(addDays(new Date(customStart + "T00:00:00"), days * dir)).slice(0,10));
      setCustomEnd(toLocalInput(addDays(new Date(customEnd + "T00:00:00"), days * dir)).slice(0,10));
    }
  }

  const periodLabel = useMemo(() => {
    if (view === "month") return fmtMonth(cursor);
    if (view === "week") {
      if (weekDays === 3) {
        const s = new Date(cursor); s.setHours(0,0,0,0); const e = addDays(s, 2);
        return `${s.toLocaleDateString("fr-FR", { day:"2-digit", month:"short" })} – ${e.toLocaleDateString("fr-FR", { day:"2-digit", month:"short", year:"numeric" })}`;
      }
      const s = startOfWeek(cursor); const e = addDays(s, 6);
      return `${s.toLocaleDateString("fr-FR", { day:"2-digit", month:"short" })} – ${e.toLocaleDateString("fr-FR", { day:"2-digit", month:"short", year:"numeric" })}`;
    }
    if (view === "day") return cursor.toLocaleDateString("fr-FR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
    if (view === "team") {
      if (teamMode === "day") return "Équipe — " + cursor.toLocaleDateString("fr-FR", { weekday: "long", day: "2-digit", month: "long" });
      const s = startOfWeek(cursor); const e = addDays(s, 6);
      return `Équipe — ${s.toLocaleDateString("fr-FR", { day:"2-digit", month:"short" })} – ${e.toLocaleDateString("fr-FR", { day:"2-digit", month:"short", year:"numeric" })}`;
    }
    if (view === "custom") {
      const a = new Date(customStart + "T00:00:00"); const b = new Date(customEnd + "T00:00:00");
      return `${a.toLocaleDateString("fr-FR",{day:"2-digit",month:"short"})} – ${b.toLocaleDateString("fr-FR",{day:"2-digit",month:"short",year:"numeric"})}`;
    }
    return "Liste";
  }, [view, cursor, customStart, customEnd, teamMode, weekDays]);


  // Keyboard shortcuts (T M S J L E N) — ignored when typing in inputs
  useEffect(() => {
    function isEditable(t: EventTarget | null) {
      if (!(t instanceof HTMLElement)) return false;
      const tag = t.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable;
    }
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isEditable(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === "escape" && fullscreen) { setFullscreen(false); return; }
      if (k === "t") { setCursor(new Date()); e.preventDefault(); }
      else if (k === "m") { setView("month"); e.preventDefault(); }
      else if (k === "s") { setView("week"); e.preventDefault(); }
      else if (k === "j") { setView("day"); e.preventDefault(); }
      else if (k === "e") { setView("team"); e.preventDefault(); }
      else if (k === "n" && canWrite) { openNew(new Date()); e.preventDefault(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canWrite, fullscreen]);

  return (
    <div className={cn("space-y-3", fullscreen && "fixed inset-0 z-50 overflow-auto bg-background p-3")}>

      <PageHeader
        title="Calendrier"
        description="Vue chantier façon Google Agenda."
        contained={false}
        className="border-0 bg-transparent px-0 py-0"
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm"><Link to="/chantiers"><ArrowLeft className="h-4 w-4" /> <span className="hidden sm:inline">Chantiers</span></Link></Button>
            {canWrite && (
              <Button onClick={() => openNew(new Date())} size="sm" className="shadow-brand">
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">Nouvel événement</span>
              </Button>
            )}
          </div>
        }
      />

      {/* Mobile toolbar: View → Date → < Aujourd'hui > → Search → Filters */}
      <Card className="flex flex-col gap-2 p-2 lg:hidden">
        {/* 1. View segmented control (Jour / 3j / Sem / Mois) */}
        <div className="inline-flex w-full rounded-md border border-border bg-muted/40 p-0.5">
          {([
            { key: "day" as const, label: "Jour" },
            { key: "week3" as const, label: "3j" },
            { key: "week" as const, label: "Sem" },
            { key: "month" as const, label: "Mois" },
          ]).map((opt) => {
            const isActive =
              (opt.key === "day" && view === "day") ||
              (opt.key === "month" && view === "month") ||
              (opt.key === "week" && view === "week" && weekDays !== 3) ||
              (opt.key === "week3" && view === "week" && weekDays === 3);
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => applyDefaultViewPreset(opt.key)}
                className={cn("flex-1 min-h-[40px] rounded-[5px] text-sm font-medium transition",
                  isActive ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
              >
                {opt.label}
              </button>
            );
          })}
        </div>


        {/* 2. Date courante */}
        <div className="text-center text-base font-semibold capitalize">{periodLabel}</div>

        {/* 3. < Aujourd'hui > */}
        <div className="flex items-center justify-between gap-2">
          <Button size="icon" variant="ghost" onClick={() => nav(-1)} aria-label="Précédent" className="h-10 w-10"><ChevronLeft className="h-5 w-5" /></Button>
          <Button size="sm" variant="outline" onClick={() => setCursor(new Date())} className="flex-1 h-10">Aujourd'hui</Button>
          <Button size="icon" variant="ghost" onClick={() => nav(1)} aria-label="Suivant" className="h-10 w-10"><ChevronRight className="h-5 w-5" /></Button>
        </div>

        {/* 4. Recherche */}
        <Popover open={search.trim().length >= 2 && searchResults.length > 0} onOpenChange={(o) => { if (!o) setSearch(""); }}>
          <PopoverTrigger asChild>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher…"
                className="h-10 pl-8"
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
        {/* 5. Filtres : reuses the same toggle button rendered below (filtersOpen / activeFilterCount). */}
      </Card>

      {/* Desktop toolbar */}
      <Card className="hidden lg:flex flex-col gap-2 p-2 lg:flex-row lg:items-center lg:justify-between">
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
          {(["month","week","day","team","custom"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)}
              className={cn("inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium transition",
                view === v ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
              {v === "team" && <Users className="h-3.5 w-3.5" />}
              {v === "month" ? "Mois" : v === "week" ? "Semaine" : v === "day" ? "Jour" : v === "team" ? "Équipe" : "Personnalisé"}
            </button>
          ))}
          {view === "team" && (
            <div className="ml-2 inline-flex overflow-hidden rounded-md border border-border">
              {(["day","week"] as const).map((m) => (
                <button key={m} onClick={() => setTeamMode(m)}
                  className={cn("px-2.5 py-1.5 text-[11px] font-medium transition",
                    teamMode === m ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-muted")}>
                  {m === "day" ? "Jour" : "Semaine"}
                </button>
              ))}
            </div>
          )}

          {(view === "week" || (view === "team" && teamMode === "week")) && (
            <div className="ml-2 inline-flex overflow-hidden rounded-md border border-border" title="Jours affichés dans la semaine">
              {([3,5,6,7] as const).map((d) => (
                <button key={d} onClick={() => setWeekDays(d)}
                  className={cn("px-2 py-1.5 text-[11px] font-medium transition",
                    weekDays === d ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-muted")}>
                  {d}j
                </button>
              ))}
            </div>
          )}

          {(view === "week" || view === "day" || view === "custom" || view === "team") && (
            <Popover>
              <PopoverTrigger asChild>
                <Button size="sm" variant="ghost" className="ml-2 gap-1" title="Zoom">
                  <ZoomIn className="h-3.5 w-3.5" /> {zoom === "compact" ? "Compact" : zoom === "confort" ? "Confort" : "Normal"}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-44 p-1">
                {(["compact","normal","confort"] as const).map((z) => (
                  <button key={z} onClick={() => setZoom(z)}
                    className={cn("flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-muted",
                      zoom === z && "bg-primary/10 text-primary")}>
                    <span className="capitalize">{z}</span>
                    <span className="text-[11px] text-muted-foreground">{ZOOM_LEVELS[z]}px/h</span>
                  </button>
                ))}
              </PopoverContent>
            </Popover>
          )}

          <Button size="icon" variant="ghost" onClick={() => setFullscreen((v) => !v)} title={fullscreen ? "Quitter plein écran (Échap)" : "Plein écran"}>
            {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
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

      {/* Filters toggle + conflicts chip */}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={filtersOpen || activeFilterCount > 0 ? "secondary" : "outline"}
          onClick={() => setFiltersOpen((v) => !v)} className="gap-1.5">
          <Filter className="h-3.5 w-3.5" />
          Filtres
          {activeFilterCount > 0 && <Badge variant="default" className="ml-1 h-5 min-w-5 justify-center px-1.5">{activeFilterCount}</Badge>}
        </Button>
        {activeFilterCount > 0 && (
          <Button size="sm" variant="ghost" onClick={resetFilters} className="text-xs text-muted-foreground">
            <X className="h-3 w-3" /> Réinitialiser
          </Button>
        )}
        {/* Color mode toggle moved into the Filters panel below. */}

        {conflicts.size > 0 && (
          <Popover open={conflictsPanelOpen} onOpenChange={setConflictsPanelOpen}>
            <PopoverTrigger asChild>
              <button type="button"
                className="ml-auto inline-flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-500/15">
                <AlertTriangle className="h-3 w-3" /> {conflicts.size} conflit{conflicts.size > 1 ? "s" : ""} de planning
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[min(440px,92vw)] p-0">
              <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Conflits détectés
              </div>
              <ul className="max-h-80 divide-y divide-border overflow-y-auto">
                {conflictPairs.map((p, i) => (
                  <li key={i} className="px-3 py-2 text-xs">
                    <div className="mb-1 font-medium text-foreground">{memberName(p.member) ?? "—"}</div>
                    {[p.a, p.b].map((ev) => (
                      <div key={ev.id} className="flex items-center justify-between gap-2 py-0.5">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: colorOf(ev).bg }} />
                          <span className="truncate">{ev.title}</span>
                          <span className="shrink-0 text-muted-foreground">
                            · {ev.start_at ? fmtTime(new Date(ev.start_at)) : "—"}
                            {ev.end_at ? `–${fmtTime(new Date(ev.end_at))}` : ""}
                          </span>
                        </span>
                        <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs"
                          onClick={() => { setConflictsPanelOpen(false); openEdit(ev); }}>
                          <Eye className="h-3 w-3" /> Voir
                        </Button>
                      </div>
                    ))}
                  </li>
                ))}
              </ul>
            </PopoverContent>
          </Popover>
        )}
      </div>

      {/* Filters */}
      {filtersOpen && (
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
        <div className="col-span-full flex flex-wrap items-center gap-2 border-t border-border/60 pt-2 text-xs">
          <button type="button" onClick={() => setFOnlyUnassigned((v) => !v)}
            className={cn("rounded-full border px-2.5 py-1 transition", fOnlyUnassigned ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted")}>
            Non assignés uniquement
          </button>
          <button type="button" onClick={() => setFHideDone((v) => !v)}
            className={cn("rounded-full border px-2.5 py-1 transition", fHideDone ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted")}>
            Masquer terminés
          </button>
          <button type="button" onClick={() => setFHideCancelled((v) => !v)}
            className={cn("rounded-full border px-2.5 py-1 transition", fHideCancelled ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted")}>
            Masquer annulés
          </button>
          {/* Color mode (admin only) — moved here from the always-visible chip row */}
          <div className="ml-auto inline-flex h-7 items-center rounded-full border border-border bg-card p-0.5">
            <span className="px-2 text-[10px] uppercase tracking-wide text-muted-foreground">Couleurs</span>
            <button type="button"
              onClick={() => isAdmin ? void persistColorMode("type") : null}
              disabled={!isAdmin}
              title={isAdmin ? "Couleur par type d'événement" : "Réglage entreprise — admin requis"}
              className={cn("rounded-full px-2 py-0.5 text-[11px] transition", colorMode === "type" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground", !isAdmin && "cursor-not-allowed opacity-70")}>
              Type
            </button>
            <button type="button"
              onClick={() => isAdmin ? void persistColorMode("chantier") : null}
              disabled={!isAdmin}
              title={isAdmin ? "Couleur héritée du chantier" : "Réglage entreprise — admin requis"}
              className={cn("rounded-full px-2 py-0.5 text-[11px] transition", colorMode === "chantier" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground", !isAdmin && "cursor-not-allowed opacity-70")}>
              Chantier
            </button>
          </div>
        </div>
        {/* Légende couleurs par type d'événement */}
        <div className="col-span-full mt-1 border-t border-border/60 pt-2">
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Légende</p>
          <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-[11px]">
            {Object.entries(TYPE_LABELS).map(([k, label]) => {
              const colorKey = TYPE_TO_COLOR[k] ?? "blue";
              const swatch = COLORS.find((c) => c.key === colorKey)!;
              return (
                <span key={k} className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: swatch.bg }} aria-hidden />
                  <span className="text-foreground">{label}</span>
                </span>
              );
            })}
          </div>
        </div>
      </Card>
      )}



      {/* Views */}
      {loading && <div className="p-8 text-center text-sm text-muted-foreground">Chargement…</div>}

      {!loading && view === "month" && (
        <MonthView
          days={monthGrid}
          cursor={cursor}
          canWrite={canWrite}
          isMobile={isMobile}
          conflictIds={conflicts}
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

      {!loading && view === "team" && (
        <TeamView
          mode={teamMode}
          cursor={cursor}
          weekDays={weekDays}
          hourPx={hourPx}
          members={members}
          events={events}
          canWrite={canWrite}
          conflictIds={conflicts}
          onClickEvent={(e) => openQuick(e)}
          onDblClickEvent={(e) => openEdit(e)}
          onCreateForMember={(memberId, start) => {
            if (!canWrite) return;
            openNew(start, new Date(start.getTime() + 60 * 60000));
            setTimeout(() => setEvtForm((f) => ({ ...f, assigned_to: memberId === UNASSIGNED ? "" : memberId })), 0);
          }}
          onReassign={(id, memberId) => void commitReassign(id, memberId === UNASSIGNED ? null : memberId)}
          chantierName={chantierName}
          clientName={clientName}
          memberName={memberName}
        />
      )}

      {!loading && (view === "week" || view === "day" || view === "custom") && (
        <TimeGridView
          days={(() => {
            const out: Date[] = [];
            const start = view === "week"
              ? (weekDays === 3 ? (() => { const d = new Date(cursor); d.setHours(0,0,0,0); return d; })() : startOfWeek(cursor))
              : (view === "day" ? cursor : range.from);
            const total = view === "week" ? weekDays : (view === "day" ? 1 : Math.min(31, Math.max(1, Math.round((range.to.getTime() - range.from.getTime())/86400000)+1)));
            for (let i = 0; i < total; i++) out.push(addDays(new Date(start.getFullYear(), start.getMonth(), start.getDate()), i));
            return out;
          })()}
          events={events}
          hourPx={hourPx}
          isMobile={isMobile}
          canWrite={canWrite}
          conflictIds={conflicts}
          onCreateRange={(s, e) => openNew(s, e)}
          onClickEvent={(e) => openQuick(e)}
          onDblClickEvent={(e) => openEdit(e)}
          onClusterMore={(evts) => setClusterSheet(evts)}
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



      {/* Mobile FAB removed — utiliser le "+" du header ou le bouton central PV de la BottomNav */}

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

      {/* Event action popup */}
      {quickEvt && activeCompanyId && (
        <EventActionPopover
          evt={quickEvt}
          companyId={activeCompanyId}
          canWrite={canWrite}
          isAdmin={isAdmin}
          memberName={(id) => (id ? membersById.get(id)?.name ?? null : null)}
          chantierName={chantierName}
          clientName={clientName}
          updateEvtFn={updateEvtFn}
          deleteEvtFn={deleteEvtFn}
          duplicateFn={duplicateFn}
          onClose={() => setQuickEvt(null)}
          onEdit={(e) => { setQuickEvt(null); openEdit(e); }}
          onSaved={() => { setQuickEvt(null); void load(); }}
        />
      )}

      {/* Conflict confirmation modal (pre-save) */}
      <AlertDialog open={!!confirmConflicts} onOpenChange={(o) => { if (!o) setConfirmConflicts(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" /> Conflit de planning détecté
            </AlertDialogTitle>
            <AlertDialogDescription>
              Cet événement chevauche {confirmConflicts?.list.length ?? 0} autre{(confirmConflicts?.list.length ?? 0) > 1 ? "s" : ""} déjà assigné{(confirmConflicts?.list.length ?? 0) > 1 ? "s" : ""} à ce membre :
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="max-h-56 overflow-y-auto rounded-md border border-border bg-muted/30 p-2 text-sm">
            {confirmConflicts?.list.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 py-1">
                <span className="truncate">{c.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {c.start_at ? new Date(c.start_at).toLocaleString("fr-FR", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" }) : "—"}
                  {c.end_at ? ` – ${new Date(c.end_at).toLocaleTimeString("fr-FR", { hour:"2-digit", minute:"2-digit" })}` : ""}
                </span>
              </li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={() => { void confirmConflicts?.proceed(); }} className="bg-red-600 hover:bg-red-600/90">
              Continuer quand même
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
  days, cursor, canWrite, isMobile, conflictIds, onDblClickDay, onClickEvent, onDblClickEvent, onMoveDay, eventsOn,
  memberName, chantierName, clientName,
}: {
  days: Date[]; cursor: Date; canWrite: boolean; isMobile?: boolean;
  conflictIds: Set<string>;
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
                  const draggable = canWrite && !isMobile && !isSystem && !!e.start_at;
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
                          className={cn("flex items-center gap-1 truncate rounded px-1.5 py-0.5 text-[11px] font-medium",
                            ann && "line-through opacity-50",
                            e.status === "termine" && "opacity-75",
                            draggable && "cursor-grab active:cursor-grabbing",
                            isDragged && "opacity-40",
                            conflictIds.has(e.id) && "ring-2 ring-red-500/80")}
                          style={{ background: c.bg, color: c.fg }}>
                          {statusIcon(e.status)}
                          {e.start_at && !e.all_day && <span className="opacity-90">{fmtTime(new Date(e.start_at))}</span>}
                          <span className="truncate">{e.title}</span>
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
const DEFAULT_HOUR_PX = 56;
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
  days, events, canWrite, isMobile, conflictIds, onCreateRange, onClickEvent, onDblClickEvent, onMove, onResize,
  onClusterMore,
  memberName, chantierName, clientName, hourPx = DEFAULT_HOUR_PX,
}: {
  days: Date[]; events: Evt[]; canWrite: boolean; isMobile?: boolean;
  conflictIds: Set<string>;
  onCreateRange: (s: Date, e: Date) => void;
  onClickEvent: (e: Evt) => void;
  onDblClickEvent: (e: Evt) => void;
  onMove: (id: string, newStart: Date) => void;
  onResize: (id: string, newEnd: Date) => void;
  onClusterMore?: (evts: Evt[]) => void;
  memberName: (id: string | null | undefined) => string | null;
  chantierName: (id: string | null | undefined) => string;
  clientName: (id: string | null | undefined) => string;
  hourPx?: number;
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
    const target = Math.max(0, (nowMin / 60) * hourPx - 120);
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
    const minutes = Math.max(0, Math.min(TOTAL_HOURS * 60, Math.round((y / (TOTAL_HOURS * hourPx)) * TOTAL_HOURS * 60 / 15) * 15));
    return { dayIdx, minutes };
  }
  function minutesToDate(day: Date, minutes: number) {
    const d = new Date(day.getFullYear(), day.getMonth(), day.getDate(), START_HOUR, 0, 0);
    d.setMinutes(minutes);
    return d;
  }

  function onMouseDownBg(e: React.MouseEvent) {
    if (!canWrite) return;
    if (isMobile) return; // mobile: no marquee selection, avoid hijacking taps/scroll
    if ((e.target as HTMLElement).closest("[data-evt]")) return;
    const p = pointerToCell(e.clientX, e.clientY); if (!p) return;
    setDrag({ kind: "select", dayIdx: p.dayIdx, startMin: p.minutes, endMin: p.minutes + 60 });
  }
  function onMouseDownEvent(e: React.MouseEvent, evt: Evt, dayIdx: number, startMin: number, endMin: number) {
    if (!canWrite || evt.event_type.startsWith("system_")) return;
    if (isMobile) return; // mobile: tap = open. Drag-to-reschedule désactivé sur mobile (cf. V2 plan).
    e.stopPropagation(); e.preventDefault();
    const p = pointerToCell(e.clientX, e.clientY); if (!p) return;
    setDrag({ kind: "move", id: evt.id, offsetMin: p.minutes - startMin, durationMin: endMin - startMin, dayIdx, startMin });
  }
  function onMouseDownResize(e: React.MouseEvent, evt: Evt, dayIdx: number, startMin: number, endMin: number) {
    if (!canWrite || evt.event_type.startsWith("system_")) return;
    if (isMobile) return;
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

  // ----- Mobile cluster overflow: si +2 events se chevauchent, on n'en garde
  // que 2 et on rend un bloc "+N autres" qui ouvre une liste. -----
  const { hiddenIds, overflows } = useMemo(() => {
    const hidden = new Set<string>();
    const overflowList: { dayIdx: number; topMin: number; heightMin: number; col: number; cols: number; evts: Evt[] }[] = [];
    if (!isMobile) return { hiddenIds: hidden, overflows: overflowList };
    // Group by day, then split into overlap clusters.
    const byDay = new Map<number, Positioned[]>();
    for (const p of positioned) {
      const arr = byDay.get(p.dayIdx) ?? [];
      arr.push(p); byDay.set(p.dayIdx, arr);
    }
    for (const [, items] of byDay) {
      const sorted = items.slice().sort((a, b) => a.topMin - b.topMin);
      let cluster: Positioned[] = [];
      let clusterEnd = -1;
      const flush = () => {
        if (cluster.length > 2) {
          const visible = cluster.slice().sort((a, b) => a.topMin - b.topMin).slice(0, 2);
          const visIds = new Set(visible.map((v) => v.evt.id));
          const hiddenEvts: Evt[] = [];
          for (const c of cluster) if (!visIds.has(c.evt.id)) { hidden.add(c.evt.id); hiddenEvts.push(c.evt); }
          const top = Math.min(...cluster.map((c) => c.topMin));
          const bottom = Math.max(...cluster.map((c) => c.topMin + c.heightMin));
          overflowList.push({
            dayIdx: cluster[0].dayIdx, topMin: top, heightMin: Math.max(40, bottom - top),
            col: 1, cols: 2, evts: hiddenEvts,
          });
        }
        cluster = []; clusterEnd = -1;
      };
      for (const it of sorted) {
        if (cluster.length === 0 || it.topMin < clusterEnd) {
          cluster.push(it);
          clusterEnd = Math.max(clusterEnd, it.topMin + it.heightMin);
        } else {
          flush();
          cluster.push(it);
          clusterEnd = it.topMin + it.heightMin;
        }
      }
      flush();
    }
    return { hiddenIds: hidden, overflows: overflowList };
  }, [positioned, isMobile]);

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
          <div className="sticky left-0 z-10 bg-background" style={{ height: TOTAL_HOURS * hourPx }}>
            {Array.from({ length: TOTAL_HOURS + 1 }).map((_, h) => (
              <div key={h} className="absolute left-0 right-0 -translate-y-2 pr-1 text-right text-[10px] font-medium text-muted-foreground" style={{ top: h * hourPx }}>
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
            style={{ gridColumn: `2 / span ${days.length}`, height: TOTAL_HOURS * hourPx, gridTemplateColumns: `repeat(${days.length}, minmax(0,1fr))`, display: "grid" }}>
            {days.map((d, i) => (
              <div key={i} className={cn("relative", isMobile ? "" : "border-l border-border", i === todayIdx && "bg-primary/[0.04]")}>
                {/* Hour lines */}
                {Array.from({ length: TOTAL_HOURS }).map((_, h) => (
                  <div key={h} className={cn("absolute left-0 right-0 border-t", isMobile ? "border-border/30" : "border-border/50")} style={{ top: h * hourPx }} />
                ))}
                {/* Half-hour subtle (desktop only — moins de quadrillage sur mobile) */}
                {!isMobile && Array.from({ length: TOTAL_HOURS }).map((_, h) => (
                  <div key={"h" + h} className="absolute left-0 right-0 border-t border-dashed border-border/20" style={{ top: h * hourPx + hourPx / 2 }} />
                ))}
              </div>
            ))}

            {/* Current time indicator */}
            {todayIdx >= 0 && nowMin >= 0 && nowMin <= TOTAL_HOURS * 60 && (
              <div className="pointer-events-none absolute z-20" style={{
                top: (nowMin / 60) * hourPx - 1,
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
              if (hiddenIds.has(evt.id)) return null;
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

              // Sur mobile, si le cluster a été ramené à 2 colonnes max, recale.
              const renderCols = isMobile ? Math.min(cols, 2) : cols;
              const renderCol = Math.min(col, renderCols - 1);
              const subW = (colWidthPct / renderCols);
              const left = `calc(${liveDayIdx * colWidthPct + renderCol * subW}% + 2px)`;
              const width = `calc(${subW}% - 4px)`;

              const startDate = evt.start_at ? new Date(evt.start_at) : null;
              const endDate = evt.end_at ? new Date(evt.end_at) : null;
              const timeLabel = startDate
                ? `${fmtTime(startDate)}${endDate ? ` → ${fmtTime(endDate)}` : ""}`
                : "";
              const chName = evt.chantier_id ? chantierName(evt.chantier_id) : null;
              const typeLabel = TYPE_LABELS[evt.event_type] ?? evt.title;

              const cardEl = (
                <div data-evt
                  onMouseDown={(e) => onMouseDownEvent(e, evt, dayIdx, topMin, topMin + heightMin)}
                  onClick={(e) => { e.stopPropagation(); if (!isDragged) onClickEvent(evt); }}
                  onDoubleClick={(e) => { e.stopPropagation(); onDblClickEvent(evt); }}
                  className={cn(
                    "absolute overflow-hidden rounded-md shadow-sm transition-shadow hover:brightness-105 hover:shadow-md",
                    isMobile ? "p-2" : "px-1.5 py-1",
                    "text-[11px] font-medium",
                    !isSystem && canWrite && !isMobile && "cursor-grab active:cursor-grabbing",
                    isMobile && "cursor-pointer",
                    ann && "line-through opacity-50",
                    evt.status === "termine" && "opacity-80",
                    isDragged && "z-30 scale-[1.02] shadow-2xl ring-2 ring-white",
                    conflictIds.has(evt.id) && !isDragged && "ring-2 ring-red-500/80",
                  )}
                  style={{
                    background: c.bg, color: c.fg,
                    left, width,
                    top: (liveTop / 60) * hourPx,
                    height: Math.max(isMobile ? 70 : 18, (liveHeight / 60) * hourPx - 2),
                    zIndex: isDragged ? 40 : 10,
                  }}>
                  {isMobile ? (
                    <div className="flex h-full flex-col justify-start gap-0.5 leading-tight">
                      {/* Ligne 1 : chantier (ou titre si pas de chantier) */}
                      <div className="flex items-center gap-1">
                        {conflictIds.has(evt.id) && <AlertTriangle className="h-3 w-3 shrink-0" />}
                        {statusIcon(evt.status)}
                        <span className="line-clamp-1 text-[13px] font-semibold">
                          {chName ?? evt.title}
                        </span>
                      </div>
                      {/* Ligne 2 : horaire */}
                      {timeLabel && (
                        <div className="text-[11px] tabular-nums opacity-95">{timeLabel}</div>
                      )}
                      {/* Ligne 3 : type métier (ou titre si déjà affiché en ligne 1) */}
                      <div className="line-clamp-1 text-[11px] opacity-90">
                        {chName ? typeLabel : (TYPE_LABELS[evt.event_type] ?? "")}
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-1 truncate">
                        {conflictIds.has(evt.id) && <AlertTriangle className="h-3 w-3 shrink-0" />}
                        {statusIcon(evt.status)}
                        <span className="truncate">{evt.title}</span>
                        {evt.assigned_to && liveHeight >= 50 && (
                          <span className="ml-auto shrink-0 rounded-sm bg-white/25 px-1 text-[9px] font-bold">{initials(memberName(evt.assigned_to))}</span>
                        )}
                      </div>
                      {liveHeight >= 30 && (
                        <div className="truncate text-[10px] opacity-90">
                          {fmtMin(liveTop)} – {fmtMin(liveTop + liveHeight)}
                        </div>
                      )}
                      {liveHeight >= 64 && evt.chantier_id && (
                        <div className="truncate text-[10px] opacity-80">{chantierName(evt.chantier_id)}</div>
                      )}
                    </>
                  )}
                  {/* resize handle (desktop only) */}
                  {!isSystem && canWrite && !isMobile && (
                    <div onMouseDown={(e) => onMouseDownResize(e, evt, dayIdx, topMin, topMin + heightMin)}
                      className="absolute inset-x-1 bottom-0 h-1.5 cursor-ns-resize rounded-b bg-white/30 opacity-0 transition-opacity hover:opacity-100 group-hover:opacity-100"
                      style={{ opacity: isDragged ? 1 : undefined }}
                    />
                  )}
                </div>
              );

              if (isMobile) return <div key={evt.id}>{cardEl}</div>;
              return (
                <HoverCard key={evt.id} openDelay={400} closeDelay={80}>
                  <HoverCardTrigger asChild>{cardEl}</HoverCardTrigger>
                  {!drag && (
                    <HoverCardContent side="right" align="start" className="w-72">
                      <EventHoverContent evt={evt} memberName={memberName} chantierName={chantierName} clientName={clientName} />
                    </HoverCardContent>
                  )}
                </HoverCard>
              );
            })}

            {/* Mobile cluster overflow pills */}
            {isMobile && overflows.map((o, idx) => {
              const subW = colWidthPct / o.cols;
              const left = `calc(${o.dayIdx * colWidthPct + o.col * subW}% + 2px)`;
              const width = `calc(${subW}% - 4px)`;
              return (
                <button
                  key={`ovf-${idx}`}
                  type="button"
                  onClick={() => onClusterMore?.(o.evts)}
                  className="absolute z-20 flex items-center justify-center rounded-md border border-dashed border-foreground/30 bg-background/80 px-2 text-[11px] font-semibold text-foreground shadow-sm backdrop-blur hover:bg-background"
                  style={{
                    left, width,
                    top: (o.topMin / 60) * hourPx,
                    height: Math.max(40, (o.heightMin / 60) * hourPx - 2),
                  }}
                >
                  +{o.evts.length} autres
                </button>
              );
            })}

            {/* Ghost selection */}
            {drag?.kind === "select" && (
              <div className="pointer-events-none absolute z-20 rounded-md border-2 border-primary/60 bg-primary/20"
                style={{
                  left: `calc(${drag.dayIdx * colWidthPct}% + 2px)`,
                  width: `calc(${colWidthPct}% - 4px)`,
                  top: (Math.min(drag.startMin, drag.endMin) / 60) * hourPx,
                  height: (Math.abs(drag.endMin - drag.startMin) / 60) * hourPx,
                }} />
            )}

            {/* Drag snap line + tooltip */}
            {dragTooltip && (
              <>
                <div className="pointer-events-none absolute left-0 right-0 z-30 border-t-2 border-dashed border-primary/70"
                  style={{ top: (dragTooltip.s / 60) * hourPx }} />
                <div className="pointer-events-none absolute z-40 rounded-md bg-foreground px-2 py-1 text-[11px] font-semibold text-background shadow-lg"
                  style={{
                    left: `calc(${dragTooltip.day ? days.indexOf(dragTooltip.day) * colWidthPct : 0}% + 4px)`,
                    top: (dragTooltip.s / 60) * hourPx - 26,
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

// ============= EVENT ACTION POPOVER =============
function EventActionPopover({
  evt, companyId, canWrite, isAdmin, memberName, chantierName, clientName,
  updateEvtFn, deleteEvtFn, duplicateFn, onClose, onEdit, onSaved,
}: {
  evt: Evt;
  companyId: string;
  canWrite: boolean;
  isAdmin: boolean;
  memberName: (id: string | null | undefined) => string | null;
  chantierName: (id: string | null | undefined) => string;
  clientName: (id: string | null | undefined) => string;
  updateEvtFn: (a: { data: { companyId: string; id: string; data: Record<string, unknown> } }) => Promise<unknown>;
  deleteEvtFn: (a: { data: { companyId: string; id: string } }) => Promise<unknown>;
  duplicateFn: (a: { data: { companyId: string; id: string } }) => Promise<unknown>;
  onClose: () => void;
  onEdit: (e: Evt) => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const isSystem = evt.event_type.startsWith("system_");
  const readOnly = !canWrite || isSystem;
  const c = colorOf(evt);
  const start = evt.start_at ? new Date(evt.start_at) : null;
  const end = evt.end_at ? new Date(evt.end_at) : null;

  const STATUS_LABEL: Record<string, string> = {
    prevu: "Prévu", en_cours: "En cours", termine: "Terminé",
    annule: "Annulé", reporte: "Reporté",
  };

  async function patchStatus(next: "termine" | "annule") {
    if (readOnly) return;
    setBusy(true);
    try {
      await updateEvtFn({ data: { companyId, id: evt.id, data: {
        title: evt.title, description: evt.description ?? "",
        event_type: evt.event_type, status: next as "prevu",
        start_at: evt.start_at, end_at: evt.end_at,
        all_day: evt.all_day ?? false, assigned_to: evt.assigned_to ?? null,
        client_id: evt.client_id ?? null, reminder_at: evt.reminder_at ?? null,
        location: evt.location ?? "", color: evt.color ?? "",
        color_source: (evt.color_source as "auto" | "manual") ?? "auto",
      } } });
      toast.success(next === "termine" ? "Marqué terminé" : "Événement annulé");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Échec");
    } finally { setBusy(false); }
  }

  async function duplicate() {
    if (readOnly) return;
    setBusy(true);
    try {
      await duplicateFn({ data: { companyId, id: evt.id } });
      toast.success("Événement dupliqué");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Duplication impossible");
    } finally { setBusy(false); }
  }

  async function remove() {
    if (readOnly || !isAdmin) return;
    if (!confirm("Supprimer cet événement ?")) return;
    setBusy(true);
    try {
      await deleteEvtFn({ data: { companyId, id: evt.id } });
      toast.success("Supprimé");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Suppression impossible");
    } finally { setBusy(false); }
  }

  const dateLine = start
    ? start.toLocaleDateString("fr-FR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })
    : "—";
  const timeLine = evt.all_day
    ? "Toute la journée"
    : start
      ? `${fmtTime(start)}${end ? ` – ${fmtTime(end)}` : ""}`
      : "—";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="overflow-hidden p-0 sm:max-w-[440px] gap-0 rounded-2xl shadow-2xl"
        onDoubleClick={() => onEdit(evt)}
      >
        <div className="flex">
          {/* Color band */}
          <div className="w-1.5 shrink-0" style={{ background: c.bg }} aria-hidden />
          <div className="flex-1 min-w-0">
            {/* Header */}
            <div className="px-5 pt-5 pb-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <DialogTitle className="text-lg leading-tight font-semibold truncate">
                    {evt.title}
                  </DialogTitle>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge
                      variant="secondary"
                      className="text-[10px] font-medium border"
                      style={{ background: c.bg + "1a", color: c.bg, borderColor: c.bg + "33" }}
                    >
                      {TYPE_LABELS[evt.event_type] ?? evt.event_type}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {STATUS_LABEL[evt.status] ?? evt.status}
                    </Badge>
                  </div>
                </div>
              </div>
            </div>

            {/* Details */}
            <div className="px-5 pb-4 space-y-2 text-sm">
              <div className="flex items-start gap-2.5 text-foreground">
                <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="capitalize">{dateLine}</p>
                  <p className="text-xs text-muted-foreground">{timeLine}</p>
                </div>
              </div>

              {evt.chantier_id && (
                <div className="flex items-center gap-2.5">
                  <span className="h-4 w-4 shrink-0 rounded-sm" style={{ background: evt.chantier?.color || c.bg }} aria-hidden />
                  <Link
                    to="/chantiers/$id"
                    params={{ id: evt.chantier_id }}
                    onClick={onClose}
                    className="truncate text-foreground hover:underline"
                  >
                    {chantierName(evt.chantier_id)}
                  </Link>
                </div>
              )}

              {evt.client_id && (
                <div className="flex items-center gap-2.5 text-muted-foreground">
                  <Users className="h-4 w-4 shrink-0" />
                  <span className="truncate">{clientName(evt.client_id)}</span>
                </div>
              )}

              {evt.assigned_to && memberName(evt.assigned_to) && (
                <div className="flex items-center gap-2.5 text-muted-foreground">
                  <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-foreground">
                    {initials(memberName(evt.assigned_to))}
                  </span>
                  <span className="truncate">{memberName(evt.assigned_to)}</span>
                </div>
              )}

              {evt.location && (
                <div className="flex items-start gap-2.5 text-muted-foreground">
                  <Eye className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="truncate">{evt.location}</span>
                </div>
              )}

              {evt.description && (
                <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground line-clamp-3">
                  {evt.description}
                </p>
              )}

              {evt.reminder_at && (
                <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5 shrink-0" />
                  <span>Rappel : {new Date(evt.reminder_at).toLocaleString("fr-FR", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" })}</span>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="border-t border-border bg-muted/30 px-3 py-2 flex flex-wrap items-center justify-between gap-1">
              <div className="flex flex-wrap items-center gap-1">
                {!readOnly && (
                  <>
                    <Button size="sm" variant="ghost" className="h-8 gap-1.5" onClick={() => onEdit(evt)} title="Modifier">
                      <Pencil className="h-3.5 w-3.5" /> Modifier
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 gap-1.5" onClick={duplicate} disabled={busy} title="Dupliquer">
                      <Copy className="h-3.5 w-3.5" /> Dupliquer
                    </Button>
                    {evt.status !== "termine" && (
                      <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-emerald-600 hover:text-emerald-700" onClick={() => patchStatus("termine")} disabled={busy} title="Marquer terminé">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Terminé
                      </Button>
                    )}
                    {evt.status !== "annule" && (
                      <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-amber-600 hover:text-amber-700" onClick={() => patchStatus("annule")} disabled={busy} title="Annuler">
                        <X className="h-3.5 w-3.5" /> Annuler
                      </Button>
                    )}
                    {isAdmin && (
                      <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-destructive hover:text-destructive" onClick={remove} disabled={busy} title="Supprimer">
                        <Trash2 className="h-3.5 w-3.5" /> Supprimer
                      </Button>
                    )}
                  </>
                )}
              </div>
              <Button size="sm" variant="outline" className="h-8" onClick={onClose}>Fermer</Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}


// ============= TEAM VIEW =============
type Member = { user_id: string; name: string };

function workloadBadge(min: number) {
  if (min >= 9 * 60) return { label: "surchargé", cls: "bg-red-500/10 text-red-600 border-red-500/30" };
  if (min >= 7 * 60) return { label: "chargé", cls: "bg-amber-500/10 text-amber-600 border-amber-500/30" };
  return { label: "normal", cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30" };
}
function fmtHrs(min: number) {
  const h = Math.floor(min / 60); const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}

function TeamView({
  mode, cursor, members, events, canWrite, conflictIds, weekDays, hourPx,
  onClickEvent, onDblClickEvent, onCreateForMember, onReassign,
  chantierName, clientName, memberName,
}: {
  mode: TeamMode;
  cursor: Date;
  members: Member[];
  events: Evt[];
  canWrite: boolean;
  conflictIds: Set<string>;
  weekDays: WeekDays;
  hourPx: number;
  onClickEvent: (e: Evt) => void;
  onDblClickEvent: (e: Evt) => void;
  onCreateForMember: (memberId: string, start: Date) => void;
  onReassign: (id: string, memberId: string) => void;
  chantierName: (id: string | null | undefined) => string;
  clientName: (id: string | null | undefined) => string;
  memberName: (id: string | null | undefined) => string | null;
}) {
  const cols = useMemo<Member[]>(
    () => [...members, { user_id: UNASSIGNED, name: "Non assigné" }],
    [members],
  );

  const workloadMap = useMemo(() => {
    const map = new Map<string, { min: number; count: number }>();
    const days = mode === "day" ? [cursor] : Array.from({ length: weekDays }, (_, i) => addDays(startOfWeek(cursor), i));
    for (const e of events) {
      if (!e.start_at || e.status === "annule" || e.event_type.startsWith("system_")) continue;
      const s = new Date(e.start_at);
      if (!days.some((d) => sameDay(d, s))) continue;
      const key = e.assigned_to ?? UNASSIGNED;
      const en = e.end_at ? new Date(e.end_at) : new Date(s.getTime() + 60 * 60000);
      const min = Math.max(0, Math.round((en.getTime() - s.getTime()) / 60000));
      const prev = map.get(key) ?? { min: 0, count: 0 };
      prev.min += min; prev.count += 1;
      map.set(key, prev);
    }
    return map;
  }, [events, mode, cursor, weekDays]);

  if (cols.length === 0) {
    return <Card className="p-8 text-center text-sm text-muted-foreground">Aucun membre dans l'équipe.</Card>;
  }

  if (mode === "week") return (
    <TeamWeekView
      cursor={cursor} cols={cols} events={events} canWrite={canWrite}
      conflictIds={conflictIds} workloadMap={workloadMap} weekDays={weekDays}
      onClickEvent={onClickEvent} onDblClickEvent={onDblClickEvent}
      onReassign={onReassign} chantierName={chantierName} clientName={clientName} memberName={memberName}
    />
  );

  return (
    <TeamDayView
      day={cursor} cols={cols} events={events} canWrite={canWrite} hourPx={hourPx}
      conflictIds={conflictIds} workloadMap={workloadMap}
      onClickEvent={onClickEvent} onDblClickEvent={onDblClickEvent}
      onCreateForMember={onCreateForMember}
      onReassign={onReassign} chantierName={chantierName} clientName={clientName} memberName={memberName}
    />
  );
}

function TeamDayView({
  day, cols, events, canWrite, conflictIds, workloadMap, hourPx,
  onClickEvent, onDblClickEvent, onCreateForMember, onReassign,
  chantierName, clientName, memberName,
}: {
  day: Date; cols: Member[]; events: Evt[]; canWrite: boolean;
  conflictIds: Set<string>;
  workloadMap: Map<string, { min: number; count: number }>;
  hourPx: number;
  onClickEvent: (e: Evt) => void;
  onDblClickEvent: (e: Evt) => void;
  onCreateForMember: (memberId: string, start: Date) => void;
  onReassign: (id: string, memberId: string) => void;
  chantierName: (id: string | null | undefined) => string;
  clientName: (id: string | null | undefined) => string;
  memberName: (id: string | null | undefined) => string | null;
}) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  type Drag = { id: string; colIdx: number; startMin: number; durationMin: number; offsetMin: number } | null;
  const [drag, setDrag] = useState<Drag>(null);
  const dragRef = useRef<Drag>(null);
  useEffect(() => { dragRef.current = drag; }, [drag]);

  function pointerToCell(clientX: number, clientY: number) {
    const grid = gridRef.current; if (!grid) return null;
    const rect = grid.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const colIdx = Math.max(0, Math.min(cols.length - 1, Math.floor((x / rect.width) * cols.length)));
    const minutes = Math.max(0, Math.min(TOTAL_HOURS * 60, Math.round((y / (TOTAL_HOURS * hourPx)) * TOTAL_HOURS * 60 / 15) * 15));
    return { colIdx, minutes };
  }
  function minutesToDate(d: Date, minutes: number) {
    const out = new Date(d.getFullYear(), d.getMonth(), d.getDate(), START_HOUR, 0, 0);
    out.setMinutes(minutes); return out;
  }

  function onMouseDownEvt(e: React.MouseEvent, evt: Evt, colIdx: number, startMin: number, durationMin: number) {
    if (!canWrite || evt.event_type.startsWith("system_")) return;
    e.stopPropagation(); e.preventDefault();
    const p = pointerToCell(e.clientX, e.clientY); if (!p) return;
    setDrag({ id: evt.id, colIdx, startMin, durationMin, offsetMin: p.minutes - startMin });
  }

  useEffect(() => {
    function mm(e: MouseEvent) {
      const d = dragRef.current; if (!d) return;
      const p = pointerToCell(e.clientX, e.clientY); if (!p) return;
      setDrag({ ...d, colIdx: p.colIdx });
    }
    function up() {
      const d = dragRef.current; if (!d) return;
      setDrag(null);
      const memberId = cols[d.colIdx]?.user_id; if (memberId === undefined) return;
      onReassign(d.id, memberId);
    }
    window.addEventListener("mousemove", mm);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", mm); window.removeEventListener("mouseup", up); };
  }, [cols, onReassign]);

  const colWidthPct = 100 / cols.length;

  // Build positioned events per column
  const positioned = useMemo(() => {
    const result: { evt: Evt; colIdx: number; topMin: number; heightMin: number }[] = [];
    for (const e of events) {
      if (!e.start_at) continue;
      const s = new Date(e.start_at);
      if (!sameDay(s, day)) continue;
      const en = e.end_at ? new Date(e.end_at) : new Date(s.getTime() + 60 * 60000);
      const startMin = (s.getHours() - START_HOUR) * 60 + s.getMinutes();
      const endMin = (en.getHours() - START_HOUR) * 60 + en.getMinutes();
      const key = e.assigned_to ?? UNASSIGNED;
      const colIdx = cols.findIndex((c) => c.user_id === key);
      if (colIdx < 0) continue;
      result.push({ evt: e, colIdx, topMin: Math.max(0, startMin), heightMin: Math.max(20, endMin - startMin) });
    }
    return result;
  }, [events, day, cols]);

  return (
    <Card className="overflow-hidden p-0">
      <div className="sticky top-0 z-30 grid border-b border-border bg-background/95 backdrop-blur" style={{ gridTemplateColumns: `56px repeat(${cols.length}, minmax(0,1fr))` }}>
        <div />
        {cols.map((c) => {
          const wl = workloadMap.get(c.user_id) ?? { min: 0, count: 0 };
          const isUnassigned = c.user_id === UNASSIGNED;
          const b = workloadBadge(wl.min);
          return (
            <div key={c.user_id} className="border-l border-border px-2 py-2 text-center">
              <div className={cn("truncate text-xs font-semibold", isUnassigned && "text-muted-foreground")}>{c.name}</div>
              <div className="mt-1 flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground">
                <span>{fmtHrs(wl.min)} · {wl.count} évt</span>
                {!isUnassigned && wl.min > 0 && (
                  <span className={cn("rounded-full border px-1.5 py-px font-medium", b.cls)}>{b.label}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div ref={scrollRef} className="relative overflow-auto" style={{ maxHeight: "72vh" }}>
        <div className="grid" style={{ gridTemplateColumns: `56px repeat(${cols.length}, minmax(0,1fr))` }}>
          <div className="sticky left-0 z-10 bg-background" style={{ height: TOTAL_HOURS * hourPx }}>
            {Array.from({ length: TOTAL_HOURS + 1 }).map((_, h) => (
              <div key={h} className="absolute left-0 right-0 -translate-y-2 pr-1 text-right text-[10px] font-medium text-muted-foreground" style={{ top: h * hourPx }}>
                {String(START_HOUR + h).padStart(2, "0")}:00
              </div>
            ))}
          </div>
          <div ref={gridRef}
            onDoubleClick={(e) => {
              if (!canWrite) return;
              if ((e.target as HTMLElement).closest("[data-evt]")) return;
              const p = pointerToCell(e.clientX, e.clientY); if (!p) return;
              const s = minutesToDate(day, p.minutes);
              onCreateForMember(cols[p.colIdx].user_id, s);
            }}
            className={cn("relative col-span-full -ml-px", drag && "cursor-grabbing select-none")}
            style={{ gridColumn: `2 / span ${cols.length}`, height: TOTAL_HOURS * hourPx, gridTemplateColumns: `repeat(${cols.length}, minmax(0,1fr))`, display: "grid" }}>
            {cols.map((c, i) => (
              <div key={c.user_id} className={cn("relative border-l border-border", c.user_id === UNASSIGNED && "bg-muted/20", drag?.colIdx === i && "bg-primary/[0.06]")}>
                {Array.from({ length: TOTAL_HOURS }).map((_, h) => (
                  <div key={h} className="absolute left-0 right-0 border-t border-border/50" style={{ top: h * hourPx }} />
                ))}
              </div>
            ))}
            {positioned.map((p, idx) => {
              const { evt, topMin, heightMin } = p;
              const c = colorOf(evt);
              const ann = evt.status === "annule";
              const isSystem = evt.event_type.startsWith("system_");
              const isDragged = drag?.id === evt.id;
              const liveColIdx = isDragged && drag ? drag.colIdx : p.colIdx;
              const isUnassignedCol = cols[liveColIdx]?.user_id === UNASSIGNED;
              return (
                <HoverCard key={evt.id + idx} openDelay={400} closeDelay={80}>
                  <HoverCardTrigger asChild>
                    <div data-evt
                      onMouseDown={(e) => onMouseDownEvt(e, evt, p.colIdx, topMin, heightMin)}
                      onClick={(e) => { e.stopPropagation(); if (!isDragged) onClickEvent(evt); }}
                      onDoubleClick={(e) => { e.stopPropagation(); onDblClickEvent(evt); }}
                      className={cn(
                        "absolute overflow-hidden rounded-md px-1.5 py-1 text-[11px] font-medium shadow-sm transition-shadow hover:brightness-105 hover:shadow-md",
                        !isSystem && canWrite && "cursor-grab active:cursor-grabbing",
                        ann && "line-through opacity-60",
                        isDragged && "z-30 scale-[1.02] shadow-2xl ring-2 ring-white",
                        conflictIds.has(evt.id) && !isDragged && "ring-2 ring-red-500/80",
                        isUnassignedCol && !isDragged && "opacity-80",
                      )}
                      style={{
                        background: c.bg, color: c.fg,
                        left: `calc(${liveColIdx * colWidthPct}% + 2px)`,
                        width: `calc(${colWidthPct}% - 4px)`,
                        top: (topMin / 60) * hourPx,
                        height: (heightMin / 60) * hourPx - 2,
                        zIndex: isDragged ? 40 : 10,
                      }}>
                      <div className="truncate flex items-center gap-1">
                        {conflictIds.has(evt.id) && <AlertTriangle className="h-3 w-3 shrink-0" />}
                        {statusIcon(evt.status)}
                        <span className="truncate">{evt.title}</span>
                      </div>

                      {heightMin >= 30 && (
                        <div className="truncate text-[10px] opacity-90">
                          {fmtMin(topMin)} – {fmtMin(topMin + heightMin)}
                        </div>
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
          </div>
        </div>
      </div>
    </Card>
  );
}

function TeamWeekView({
  cursor, cols, events, canWrite, conflictIds, workloadMap, weekDays,
  onClickEvent, onDblClickEvent, onReassign,
  chantierName, clientName, memberName,
}: {
  cursor: Date; cols: Member[]; events: Evt[]; canWrite: boolean;
  conflictIds: Set<string>;
  workloadMap: Map<string, { min: number; count: number }>;
  weekDays: WeekDays;
  onClickEvent: (e: Evt) => void;
  onDblClickEvent: (e: Evt) => void;
  onReassign: (id: string, memberId: string) => void;
  chantierName: (id: string | null | undefined) => string;
  clientName: (id: string | null | undefined) => string;
  memberName: (id: string | null | undefined) => string | null;
}) {
  const days = useMemo(() => Array.from({ length: weekDays }, (_, i) => addDays(startOfWeek(cursor), i)), [cursor, weekDays]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overMember, setOverMember] = useState<string | null>(null);

  function evtsFor(memberId: string, day: Date) {
    return events.filter((e) => e.start_at && sameDay(new Date(e.start_at), day) && (e.assigned_to ?? UNASSIGNED) === memberId);
  }

  return (
    <Card className="overflow-hidden p-0">
      <div className="grid border-b border-border bg-background/95 text-xs" style={{ gridTemplateColumns: `180px repeat(${days.length}, minmax(0,1fr))` }}>
        <div className="border-r border-border p-2 font-semibold uppercase tracking-wide text-muted-foreground">Membre</div>
        {days.map((d, i) => {
          const isToday = sameDay(d, new Date());
          return (
            <div key={i} className="border-l border-border px-2 py-2 text-center">
              <div className="uppercase tracking-wide text-[10px] text-muted-foreground">{d.toLocaleDateString("fr-FR", { weekday: "short" })}</div>
              <div className={cn("mx-auto mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold", isToday && "bg-primary text-primary-foreground")}>{d.getDate()}</div>
            </div>
          );
        })}
      </div>
      <div className="divide-y divide-border">
        {cols.map((c) => {
          const wl = workloadMap.get(c.user_id) ?? { min: 0, count: 0 };
          const isUnassigned = c.user_id === UNASSIGNED;
          const b = workloadBadge(wl.min);
          const isOver = overMember === c.user_id && dragId;
          return (
            <div key={c.user_id} className={cn("grid", isOver && "bg-primary/[0.06]")} style={{ gridTemplateColumns: `180px repeat(${days.length}, minmax(0,1fr))` }}
              onDragOver={(e) => { if (canWrite && dragId) { e.preventDefault(); if (overMember !== c.user_id) setOverMember(c.user_id); } }}
              onDragLeave={() => { if (overMember === c.user_id) setOverMember(null); }}
              onDrop={(e) => { e.preventDefault(); if (canWrite && dragId) { const id = dragId; setDragId(null); setOverMember(null); onReassign(id, c.user_id); } }}>
              <div className="border-r border-border p-2">
                <div className={cn("truncate text-sm font-medium", isUnassigned && "text-muted-foreground")}>{c.name}</div>
                <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <span>{fmtHrs(wl.min)} · {wl.count} évt</span>
                  {!isUnassigned && wl.min > 0 && (
                    <span className={cn("rounded-full border px-1.5 py-px font-medium", b.cls)}>{b.label}</span>
                  )}
                </div>
              </div>
              {days.map((d, i) => {
                const dayEvts = evtsFor(c.user_id, d);
                return (
                  <div key={i} className="min-h-[72px] border-l border-border p-1.5 text-xs">
                    <div className="space-y-1">
                      {dayEvts.map((e) => {
                        const col = colorOf(e);
                        const isSystem = e.event_type.startsWith("system_");
                        const draggable = canWrite && !isSystem;
                        const ann = e.status === "annule";
                        return (
                          <HoverCard key={e.id} openDelay={350} closeDelay={80}>
                            <HoverCardTrigger asChild>
                              <div
                                draggable={draggable}
                                onDragStart={() => { if (draggable) setDragId(e.id); }}
                                onDragEnd={() => { setDragId(null); setOverMember(null); }}
                                onClick={(ev) => { ev.stopPropagation(); onClickEvent(e); }}
                                onDoubleClick={(ev) => { ev.stopPropagation(); onDblClickEvent(e); }}
                                className={cn("flex items-center gap-1 truncate rounded px-1.5 py-1 text-[11px] font-medium",
                                  ann && "line-through opacity-50",
                                  e.status === "termine" && "opacity-75",
                                  draggable && "cursor-grab active:cursor-grabbing",
                                  conflictIds.has(e.id) && "ring-2 ring-red-500/80")}
                                style={{ background: col.bg, color: col.fg }}>
                                {conflictIds.has(e.id) && <AlertTriangle className="h-3 w-3 shrink-0" />}
                                {statusIcon(e.status)}
                                {e.start_at && !e.all_day && <span className="opacity-90">{fmtTime(new Date(e.start_at))}</span>}
                                <span className="truncate">{e.title}</span>

                              </div>
                            </HoverCardTrigger>
                            <HoverCardContent side="right" align="start" className="w-72">
                              <EventHoverContent evt={e} memberName={memberName} chantierName={chantierName} clientName={clientName} />
                            </HoverCardContent>
                          </HoverCard>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </Card>
  );
}


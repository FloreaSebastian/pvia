import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, MapPin, Calendar as CalendarIcon, Plus, FileText, StickyNote, Paperclip, Clock, CheckCircle2, AlertCircle, Trash2, Building2, User, Phone, Mail, Upload, ExternalLink, Sparkles, Pencil, Info, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { StatusPill } from "@/components/ui/status-pill";
import { Progress } from "@/components/ui/progress";
import { PageHeader } from "@/components/app/PageHeader";
import { useServerFn } from "@tanstack/react-start";
import { useCompany } from "@/hooks/use-company";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  getChantierDetail, createChantierEvent, updateChantierEvent, deleteChantierEvent,
  createChantierNote, updateChantierNote, deleteChantierNote,
  createChantierDocument, deleteChantierDocument,
  listCompanyMembers, createChantierAutoPlanning, updateChantierProgress,
} from "@/lib/chantier-detail.functions";
import { reopenChantier } from "@/lib/chantiers.functions";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DossierTab } from "@/components/chantiers/DossierTab";


export const Route = createFileRoute("/_authenticated/chantiers/$id")({
  component: ChantierDetailPage,
  head: () => ({ meta: [{ title: "Chantier — PVIA" }] }),
});

const EVENT_TYPES = [
  { value: "visite_technique", label: "Visite technique", color: "info" },
  { value: "debut_travaux", label: "Début travaux", color: "primary" },
  { value: "livraison_materiel", label: "Livraison matériel", color: "info" },
  { value: "intervention", label: "Intervention", color: "primary" },
  { value: "controle_qualite", label: "Contrôle qualité", color: "warning" },
  { value: "reception", label: "Réception", color: "success" },
  { value: "sav", label: "SAV", color: "warning" },
  { value: "retard", label: "Retard", color: "danger" },
  { value: "remarque", label: "Remarque", color: "neutral" },
  { value: "appel_client", label: "Appel client", color: "neutral" },
  { value: "rappel", label: "Rappel administratif", color: "neutral" },
] as const;

const EVENT_STATUSES = [
  { value: "prevu", label: "Prévu" },
  { value: "en_cours", label: "En cours" },
  { value: "termine", label: "Terminé" },
  { value: "annule", label: "Annulé" },
  { value: "reporte", label: "Reporté" },
] as const;

const DOC_CATEGORIES = [
  { value: "devis", label: "Devis" },
  { value: "bon_commande", label: "Bon de commande" },
  { value: "photo", label: "Photo" },
  { value: "plan", label: "Plan" },
  { value: "pv", label: "PV" },
  { value: "facture", label: "Facture" },
  { value: "autre", label: "Autre" },
] as const;

function evtLabel(t: string) { return EVENT_TYPES.find((e) => e.value === t)?.label ?? t; }
function fmtDateTime(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("fr-FR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function fmtDate(d: string | null | undefined) {
  if (!d) return null;
  return new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

type Detail = Awaited<ReturnType<typeof getChantierDetail>>;

function ChantierDetailPage() {
  const { id } = Route.useParams();
  const { activeCompanyId, can } = useCompany();
  const canWrite = can("manage");
  const isAdmin = can("admin");
  const navigate = useNavigate();
  const [d, setD] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchDetail = useServerFn(getChantierDetail);
  const createEvtFn = useServerFn(createChantierEvent);
  const updateEvtFn = useServerFn(updateChantierEvent);
  const deleteEvtFn = useServerFn(deleteChantierEvent);
  const createNoteFn = useServerFn(createChantierNote);
  const updateNoteFn = useServerFn(updateChantierNote);
  const deleteNoteFn = useServerFn(deleteChantierNote);
  const createDocFn = useServerFn(createChantierDocument);
  const deleteDocFn = useServerFn(deleteChantierDocument);
  const fetchMembers = useServerFn(listCompanyMembers);
  const autoPlanFn = useServerFn(createChantierAutoPlanning);
  const reopenFn = useServerFn(reopenChantier);
  const updateProgressFn = useServerFn(updateChantierProgress);
  const [autoPlanLoading, setAutoPlanLoading] = useState(false);
  const [reopenLoading, setReopenLoading] = useState(false);


  async function handleReopen() {
    if (!activeCompanyId) return;
    if (!confirm("Réouvrir ce chantier ? Il repassera en « En cours ».")) return;
    setReopenLoading(true);
    try {
      await reopenFn({ data: { companyId: activeCompanyId, id } });
      toast.success("Chantier réouvert.");
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Réouverture impossible.");
    } finally { setReopenLoading(false); }
  }

  async function runAutoPlanning(replace = false) {
    if (!activeCompanyId) return;
    if (!replace && !confirm("Créer un planning automatique (6 événements) ? Vous pourrez ensuite modifier chaque étape.")) return;
    setAutoPlanLoading(true);
    try {
      const r = await autoPlanFn({ data: { companyId: activeCompanyId, chantierId: id, replace } });
      toast.success(`${r.count} événements créés${r.replaced ? " (planning précédent remplacé)" : ""}`);
      await reload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Création impossible";
      if (msg === "AUTO_PLANNING_EXISTS") {
        if (confirm("Un planning automatique existe déjà pour ce chantier.\n\nRemplacer le planning existant ?")) {
          await runAutoPlanning(true);
          return;
        }
        toast.info("Création annulée — planning existant conservé.");
      } else {
        toast.error(msg);
      }
    } finally { setAutoPlanLoading(false); }
  }

  const [members, setMembers] = useState<{ user_id: string; name: string; role: string }[]>([]);
  const membersById = useMemo(() => new Map(members.map((m) => [m.user_id, m])), [members]);

  async function reload() {
    if (!activeCompanyId) return;
    setLoading(true);
    try {
      const r = await fetchDetail({ data: { companyId: activeCompanyId, id } });
      setD(r);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Chargement impossible");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id, activeCompanyId]);
  useEffect(() => {
    if (!activeCompanyId) return;
    fetchMembers({ data: { companyId: activeCompanyId } })
      .then((r) => setMembers(r.members))
      .catch(() => { /* non-blocking */ });
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [activeCompanyId]);

  // event dialog
  const [evtOpen, setEvtOpen] = useState(false);
  const [evtEditing, setEvtEditing] = useState<string | null>(null);
  const emptyEvt = { title: "", description: "", event_type: "intervention", status: "prevu", start_at: "", end_at: "", all_day: false, location: "", color: "", assigned_to: "", reminder_at: "" };
  const [evtForm, setEvtForm] = useState(emptyEvt);
  function openNewEvt() { setEvtEditing(null); setEvtForm(emptyEvt); setEvtOpen(true); }
  function openEditEvt(e: Detail["events"][number]) {
    setEvtEditing(e.id);
    setEvtForm({
      title: e.title, description: e.description ?? "", event_type: e.event_type,
      status: e.status, start_at: e.start_at?.slice(0, 16) ?? "", end_at: e.end_at?.slice(0, 16) ?? "",
      all_day: e.all_day ?? false, location: e.location ?? "", color: e.color ?? "",
      assigned_to: (e as { assigned_to?: string | null }).assigned_to ?? "",
      reminder_at: (e as { reminder_at?: string | null }).reminder_at?.slice(0, 16) ?? "",
    });
    setEvtOpen(true);
  }
  async function saveEvt(e: React.FormEvent) {
    e.preventDefault();
    if (!activeCompanyId) return;
    try {
      const payload = {
        title: evtForm.title, description: evtForm.description,
        event_type: evtForm.event_type, status: evtForm.status as "prevu",
        start_at: evtForm.start_at ? new Date(evtForm.start_at).toISOString() : null,
        end_at: evtForm.end_at ? new Date(evtForm.end_at).toISOString() : null,
        all_day: evtForm.all_day, location: evtForm.location, color: evtForm.color,
        assigned_to: evtForm.assigned_to ? evtForm.assigned_to : null,
        reminder_at: evtForm.reminder_at ? new Date(evtForm.reminder_at).toISOString() : null,
      };
      if (evtEditing) {
        await updateEvtFn({ data: { companyId: activeCompanyId, id: evtEditing, data: payload } });
        toast.success("Événement modifié");
      } else {
        await createEvtFn({ data: { companyId: activeCompanyId, chantierId: id, data: payload } });
        toast.success("Événement créé");
      }
      setEvtOpen(false);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Échec");
    }
  }
  async function removeEvt(eid: string) {
    if (!activeCompanyId || !confirm("Supprimer cet événement ?")) return;
    try { await deleteEvtFn({ data: { companyId: activeCompanyId, id: eid } }); toast.success("Supprimé"); await reload(); }
    catch (err) { toast.error(err instanceof Error ? err.message : "Échec"); }
  }

  // note dialog (create + edit)
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteEditing, setNoteEditing] = useState<string | null>(null);
  const [notesListOpen, setNotesListOpen] = useState(false);
  const emptyNote = { note: "", visibility: "internal" as "internal" | "client", priority: "normal" as "low" | "normal" | "high", reminder_at: "" };
  const [noteForm, setNoteForm] = useState(emptyNote);
  function openNewNote() { setNoteEditing(null); setNoteForm(emptyNote); setNoteOpen(true); }
  function openEditNote(n: { id: string; note: string; visibility: string; priority: string; reminder_at: string | null }) {
    setNoteEditing(n.id);
    setNoteForm({
      note: n.note,
      visibility: (n.visibility === "client" ? "client" : "internal"),
      priority: (n.priority === "high" ? "high" : n.priority === "low" ? "low" : "normal"),
      reminder_at: n.reminder_at ? n.reminder_at.slice(0, 16) : "",
    });
    setNoteOpen(true);
  }
  async function saveNote(e: React.FormEvent) {
    e.preventDefault();
    if (!activeCompanyId) return;
    try {
      const payload = {
        note: noteForm.note, visibility: noteForm.visibility, priority: noteForm.priority,
        reminder_at: noteForm.reminder_at ? new Date(noteForm.reminder_at).toISOString() : null,
      };
      if (noteEditing) {
        await updateNoteFn({ data: { companyId: activeCompanyId, id: noteEditing, data: payload } });
        toast.success("Note modifiée");
      } else {
        await createNoteFn({ data: { companyId: activeCompanyId, chantierId: id, data: payload } });
        toast.success("Note ajoutée");
      }
      setNoteOpen(false);
      setNoteEditing(null);
      setNoteForm(emptyNote);
      await reload();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Échec"); }
  }
  async function removeNote(nid: string) {
    if (!activeCompanyId || !confirm("Supprimer cette note ?")) return;
    try { await deleteNoteFn({ data: { companyId: activeCompanyId, id: nid } }); toast.success("Supprimé"); await reload(); }
    catch (err) { toast.error(err instanceof Error ? err.message : "Échec"); }
  }

  // event detail dialog
  const [evtDetailId, setEvtDetailId] = useState<string | null>(null);

  // documents bottom-sheet
  const [docsOpen, setDocsOpen] = useState(false);

  // tabs (controlled to allow KPI deep-link)
  const [tabValue, setTabValue] = useState<"overview" | "dossier">("overview");


  // progress dialog
  const [progressOpen, setProgressOpen] = useState(false);
  const [progressValue, setProgressValue] = useState<number>(0);
  async function saveProgress() {
    if (!activeCompanyId) return;
    try {
      await updateProgressFn({ data: { companyId: activeCompanyId, id, progress_percent: progressValue } });
      toast.success("Avancement mis à jour");
      setProgressOpen(false);
      await reload();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Échec"); }
  }


  // upload doc
  const [uploading, setUploading] = useState(false);
  const [docCategory, setDocCategory] = useState<typeof DOC_CATEGORIES[number]["value"]>("autre");
  async function handleFileUpload(file: File) {
    if (!activeCompanyId) return;
    setUploading(true);
    try {
      const path = `chantiers/${id}/${Date.now()}-${file.name.replace(/[^\w.-]/g, "_")}`;
      const { error: upErr } = await supabase.storage.from("pv-assets").upload(path, file, { upsert: false });
      if (upErr) throw upErr;
      const { data: signed } = await supabase.storage.from("pv-assets").createSignedUrl(path, 60 * 60 * 24 * 7);
      const url = signed?.signedUrl ?? "";
      await createDocFn({ data: { companyId: activeCompanyId, chantierId: id, data: {
        name: file.name, file_url: url, storage_path: path, file_type: file.type, category: docCategory,
      } } });
      toast.success("Document ajouté");
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload impossible");
    } finally { setUploading(false); }
  }
  async function removeDoc(did: string) {
    if (!activeCompanyId || !confirm("Supprimer ce document ?")) return;
    try { await deleteDocFn({ data: { companyId: activeCompanyId, id: did } }); toast.success("Supprimé"); await reload(); }
    catch (err) { toast.error(err instanceof Error ? err.message : "Échec"); }
  }

  const timeline = useMemo(() => d?.events ?? [], [d]);
  
  const userEvents = useMemo(() => timeline.filter((e) => !e.event_type.startsWith("system_")), [timeline]);

  const STATUS_LABELS_TL: Record<string, string> = { preparation: "Préparation", planifie: "Planifié", en_cours: "En cours", en_attente: "En attente", receptionne: "Réceptionné", termine: "Terminé", archive: "Archivé" };

  // Unified chronological timeline (P2.6): chantier creation + events + PVs
  // + documents, important notes, reserves, status/progress changes
  type TLItem = {
    id: string; date: string; title: string;
    kind: "create" | "event" | "system" | "pv" | "document" | "note" | "reserve" | "status" | "progress";
    subtitle?: string; status?: string; tone?: "success" | "info" | "warning" | "neutral" | "danger";
  };
  const unifiedTimeline = useMemo<TLItem[]>(() => {
    if (!d) return [];
    const out: TLItem[] = [];
    if (d.chantier.created_at) {
      out.push({ id: `c-${d.chantier.id}`, date: d.chantier.created_at, title: "Chantier créé", kind: "create", subtitle: d.chantier.name, tone: "info" });
    }
    for (const e of timeline) {
      const isSys = e.event_type.startsWith("system_");
      out.push({
        id: `e-${e.id}`,
        date: e.start_at ?? e.created_at ?? new Date().toISOString(),
        title: e.title,
        kind: isSys ? "system" : "event",
        subtitle: isSys ? undefined : evtLabel(e.event_type),
        status: e.status,
        tone: e.status === "termine" ? "success" : e.status === "annule" ? "danger" : isSys ? "neutral" : "info",
      });
    }
    for (const p of d.pvs) {
      out.push({ id: `pv-c-${p.id}`, date: p.created_at, title: `PV créé ${p.numero ?? ""}`.trim(), kind: "pv", subtitle: p.type, tone: "neutral" });
      if (p.signed_at) out.push({ id: `pv-s-${p.id}`, date: p.signed_at, title: `PV signé ${p.numero ?? ""}`.trim(), kind: "pv", subtitle: p.type, tone: "success" });
      if (p.sent_to_client_at) out.push({ id: `pv-x-${p.id}`, date: p.sent_to_client_at, title: `PV envoyé au client ${p.numero ?? ""}`.trim(), kind: "pv", tone: "info" });
    }
    // Documents
    for (const doc of (d as { documents?: Array<{ id: string; name: string; category: string | null; created_at: string }> }).documents ?? []) {
      out.push({
        id: `doc-${doc.id}`, date: doc.created_at,
        title: `Document ajouté · ${doc.name}`,
        kind: "document", subtitle: doc.category ?? undefined, tone: "neutral",
      });
    }
    // Notes importantes (priority !== 'normal')
    for (const n of (d as { notes?: Array<{ id: string; note: string; priority: string; created_at: string }> }).notes ?? []) {
      if (n.priority && n.priority !== "normal") {
        const preview = n.note.length > 90 ? n.note.slice(0, 90) + "…" : n.note;
        out.push({
          id: `note-${n.id}`, date: n.created_at,
          title: `Note importante · ${preview}`,
          kind: "note", subtitle: n.priority, tone: "warning",
        });
      }
    }
    // Réserves : créée / levée / validée
    for (const r of (d as { reserves?: Array<{ id: string; description: string; severity: string; status: string; created_at: string; lifted_at: string | null; validated_at: string | null }> }).reserves ?? []) {
      const preview = r.description.length > 80 ? r.description.slice(0, 80) + "…" : r.description;
      out.push({
        id: `rv-c-${r.id}`, date: r.created_at,
        title: `Réserve créée · ${preview}`,
        kind: "reserve", subtitle: r.severity, tone: r.severity === "majeure" ? "danger" : "warning",
      });
      if (r.lifted_at) out.push({
        id: `rv-l-${r.id}`, date: r.lifted_at,
        title: `Réserve levée · ${preview}`,
        kind: "reserve", tone: "success",
      });
      if (r.validated_at) out.push({
        id: `rv-v-${r.id}`, date: r.validated_at,
        title: `Réserve validée · ${preview}`,
        kind: "reserve", tone: "success",
      });
    }
    // Audit logs — status & progression changes
    const auditLogs = (d as { auditLogs?: Array<{ id: string; action: string; old_values: Record<string, unknown> | null; new_values: Record<string, unknown> | null; created_at: string }> }).auditLogs ?? [];
    for (const a of auditLogs) {
      if (a.action !== "chantier.update") continue;
      const ov = a.old_values ?? {}; const nv = a.new_values ?? {};
      if ("status" in nv && nv.status !== ov.status) {
        const from = (ov.status as string | undefined) ?? "—";
        const to = (nv.status as string | undefined) ?? "—";
        out.push({
          id: `st-${a.id}`, date: a.created_at,
          title: `Statut chantier : ${STATUS_LABELS_TL[from] ?? from} → ${STATUS_LABELS_TL[to] ?? to}`,
          kind: "status", tone: "info",
        });
      }
      if ("progress_percent" in nv && nv.progress_percent !== ov.progress_percent) {
        const from = (ov.progress_percent as number | undefined) ?? 0;
        const to = (nv.progress_percent as number | undefined) ?? 0;
        out.push({
          id: `pr-${a.id}`, date: a.created_at,
          title: `Progression : ${from}% → ${to}%`,
          kind: "progress", tone: to >= 100 ? "success" : "info",
        });
      }
    }
    return out.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [d, timeline]);

  if (loading && !d) return <div className="p-8 text-sm text-muted-foreground">Chargement…</div>;
  if (!d) return <div className="p-8 text-sm text-muted-foreground">Chantier introuvable.</div>;

  const ch = d.chantier;
  const stats = d.stats;
  const STATUS_LABELS: Record<string, string> = { preparation: "Préparation", planifie: "Planifié", en_cours: "En cours", en_attente: "En attente", receptionne: "🏁 Réceptionné", termine: "✅ Terminé", archive: "📦 Archivé" };
  const statusLabel = STATUS_LABELS[ch.status] ?? ch.status;
  const statusTone: "success" | "info" | "warning" | "neutral" =
    ch.status === "receptionne" ? "success"
    : ch.status === "termine" ? "success"
    : ch.status === "archive" ? "neutral"
    : ch.status === "planifie" ? "info"
    : ch.status === "en_cours" || ch.status === "en_attente" ? "warning"
    : "neutral";
  const chColor = (ch as { color?: string | null }).color ?? null;
  const chProgress = (ch as { progress_percent?: number | null }).progress_percent ?? 0;
  const chReceivedAt = (ch as { received_at?: string | null }).received_at ?? null;
  const chClosedAt = (ch as { closed_at?: string | null }).closed_at ?? null;
  const chClosureOrigin = (ch as { closure_origin?: string | null }).closure_origin ?? null;
  const isLocked = ch.status === "termine" || ch.status === "archive";
  const closureOriginLabel =
    chClosureOrigin === "pv_no_reserve" ? "PV signé sans réserve"
    : chClosureOrigin === "reserves_validated" ? "Toutes réserves validées"
    : chClosureOrigin === "manual" ? "Clôture manuelle"
    : null;

  const reservesCount = ((d as { reserves?: unknown[] }).reserves ?? []).length;
  const pvCount = d.pvs.length;
  const eventsCount = userEvents.length;
  const docsCount = d.documents.length;
  const surface = (ch as { surface_m2?: number | null }).surface_m2 ?? null;

  return (
    <div className="space-y-4 md:space-y-6">
      {/* ====== MOBILE HEADER ====== */}
      <div className="md:hidden">
        <button
          onClick={() => navigate({ to: "/chantiers" })}
          className="-ml-2 inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Retour
        </button>
        <div className="mt-2 min-w-0">
          <h1 className="truncate text-xl font-bold leading-tight">
            {ch.name}{surface != null && <span className="ml-1 text-sm font-normal text-muted-foreground">{surface}m²</span>}
          </h1>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <StatusPill tone={statusTone} size="sm" dot>{statusLabel}</StatusPill>
          {ch.type && <StatusPill tone="neutral" size="sm">🏗️ {ch.type}</StatusPill>}
          {isLocked && <StatusPill tone="neutral" size="sm">🔒</StatusPill>}
        </div>
        {/* Quick actions 3 cols */}
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Button asChild variant="outline" size="sm" className="h-11 flex-col gap-0.5 px-1 text-[11px]">
            <Link to="/chantiers/calendrier"><CalendarIcon className="h-4 w-4" /><span>Calendrier</span></Link>
          </Button>
          {canWrite && !isLocked ? (
            <Button variant="default" size="sm" className="h-11 flex-col gap-0.5 px-1 text-[11px]" onClick={openNewEvt}>
              <Plus className="h-4 w-4" /><span>Événement</span>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled className="h-11 flex-col gap-0.5 px-1 text-[11px]">
              <Plus className="h-4 w-4" /><span>Événement</span>
            </Button>
          )}
          {canWrite && !isLocked ? (
            <Button variant="outline" size="sm" className="h-11 flex-col gap-0.5 px-1 text-[11px]" onClick={() => runAutoPlanning(false)} disabled={autoPlanLoading}>
              <Sparkles className="h-4 w-4" /><span>{autoPlanLoading ? "…" : "Planning"}</span>
            </Button>
          ) : isLocked && isAdmin ? (
            <Button variant="outline" size="sm" className="h-11 flex-col gap-0.5 px-1 text-[11px]" onClick={handleReopen} disabled={reopenLoading}>
              <Sparkles className="h-4 w-4" /><span>{reopenLoading ? "…" : "Réouvrir"}</span>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled className="h-11 flex-col gap-0.5 px-1 text-[11px]">
              <Sparkles className="h-4 w-4" /><span>Planning</span>
            </Button>
          )}
        </div>
      </div>

      {/* ====== DESKTOP HEADER ====== */}
      <div className="hidden md:block">
        <PageHeader
          title={ch.name}
          description={ch.type ?? "Chantier"}
          contained={false}
          className="border-0 bg-transparent px-0 py-0"
          actions={
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/chantiers" })}>
                <ArrowLeft className="h-4 w-4" /> Retour
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link to="/chantiers/calendrier"><CalendarIcon className="h-4 w-4" /> Calendrier</Link>
              </Button>
              {canWrite && !isLocked && (
                <Button variant="outline" size="sm" onClick={() => runAutoPlanning(false)} disabled={autoPlanLoading}>
                  <Sparkles className="h-4 w-4" /> {autoPlanLoading ? "Création…" : "Planning auto"}
                </Button>
              )}
              {isLocked && isAdmin && (
                <Button variant="outline" size="sm" onClick={handleReopen} disabled={reopenLoading}>
                  {reopenLoading ? "Réouverture…" : "Réouvrir le chantier"}
                </Button>
              )}
              {canWrite && !isLocked && (
                <Button onClick={openNewEvt} className="shadow-brand">
                  <Plus className="h-4 w-4" /> Nouvel événement
                </Button>
              )}
            </div>
          }
        />
      </div>

      <Tabs value={tabValue} onValueChange={(v) => setTabValue(v as "overview" | "dossier")} className="w-full">
        <TabsList className="sticky top-0 z-30 grid w-full grid-cols-2 border-b border-border bg-background/95 shadow-sm backdrop-blur md:static md:inline-flex md:w-auto md:border-0 md:bg-muted md:shadow-none">
          <TabsTrigger value="overview">Vue</TabsTrigger>
          <TabsTrigger value="dossier">Dossier</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-3 md:mt-4">
          {/* ====== MOBILE OVERVIEW ====== */}
          <div className="space-y-3 md:hidden">
            {/* Informations */}
            <Card className="p-3 text-sm">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Informations</h3>
              <div className="space-y-2">
                {ch.address && (
                  <p className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /><span className="min-w-0 break-words">{ch.address}</span></p>
                )}
                {ch.client && (
                  <>
                    <p className="flex items-center gap-2"><User className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="truncate">{ch.client.name}</span></p>
                    {ch.client.email && (
                      <a href={`mailto:${ch.client.email}`} className="flex items-center gap-2 text-primary"><Mail className="h-4 w-4 shrink-0" /><span className="truncate">{ch.client.email}</span></a>
                    )}
                    {ch.client.phone && (
                      <a href={`tel:${ch.client.phone}`} className="flex items-center gap-2 text-primary"><Phone className="h-4 w-4 shrink-0" /><span className="truncate">{ch.client.phone}</span></a>
                    )}
                  </>
                )}
              </div>
            </Card>

            {/* Planning — 2 cols */}
            <div className="grid grid-cols-2 gap-2">
              <Card className="p-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Début</p>
                <p className="mt-1 text-sm font-semibold">{fmtDate(ch.start_date) ?? "—"}</p>
              </Card>
              <Card className="p-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Fin prévue</p>
                <p className="mt-1 text-sm font-semibold">{fmtDate(ch.end_date) ?? "—"}</p>
              </Card>
            </div>

            {/* KPI 2x2 — Réserves / PV / Événements / Documents */}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setTabValue("dossier")} className="text-left">
                <Card className="p-3 transition active:scale-[0.98]">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Réserves</p>
                  <p className="mt-1 text-xl font-bold tabular-nums">{reservesCount}</p>
                </Card>
              </button>
              <button type="button" onClick={() => setTabValue("dossier")} className="text-left">

                <Card className="p-3 transition active:scale-[0.98]">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">PV</p>
                  <p className="mt-1 text-xl font-bold tabular-nums">{pvCount}</p>
                </Card>
              </button>
              <button type="button" onClick={() => navigate({ to: "/chantiers/calendrier" })} className="text-left">
                <Card className="p-3 transition active:scale-[0.98]">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Événements</p>
                  <p className="mt-1 text-xl font-bold tabular-nums">{eventsCount}</p>
                </Card>
              </button>
              <button type="button" onClick={() => setDocsOpen(true)} className="text-left">
                <Card className="p-3 transition active:scale-[0.98]">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Documents</p>
                  <p className="mt-1 text-xl font-bold tabular-nums">{docsCount}</p>
                </Card>
              </button>
            </div>

            {/* Avancement bar */}
            <Card className="p-3">
              <div className="mb-1.5 flex items-center justify-between text-xs">
                <span className="font-medium">Avancement</span>
                <div className="flex items-center gap-2">
                  <span className="tabular-nums font-semibold">{chProgress}%</span>
                  {canWrite && !isLocked && (
                    <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Modifier l'avancement"
                      onClick={() => { setProgressValue(chProgress); setProgressOpen(true); }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
              <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${Math.max(0, Math.min(100, chProgress))}%`, backgroundColor: chColor || "hsl(var(--primary))" }}
                />
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-muted-foreground tabular-nums">
                <span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span>
              </div>
              <p className="mt-2 flex items-start gap-1 text-[10px] text-muted-foreground">
                <Info className="mt-0.5 h-3 w-3 shrink-0" />
                <span>Auto : {stats.done}/{stats.total} événements terminés ({stats.progress}%). Modifiable manuellement.</span>
              </p>
            </Card>

            {/* Timeline (mobile) */}
            <Card className="p-3">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="inline-flex items-center gap-2 text-sm font-semibold"><CalendarIcon className="h-4 w-4" /> Timeline</h3>
                {canWrite && !isLocked && userEvents.length > 0 && (
                  <Button size="sm" variant="ghost" className="h-7 px-2" onClick={openNewEvt}><Plus className="h-3.5 w-3.5" /></Button>
                )}
              </div>
              {userEvents.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-4 text-center">
                  <p className="text-sm text-muted-foreground">📅 Aucun événement</p>
                  <p className="text-xs text-muted-foreground">Créez votre premier événement</p>
                  {canWrite && !isLocked && (
                    <Button size="sm" onClick={openNewEvt} className="mt-1"><Plus className="h-3.5 w-3.5" /> Ajouter un événement</Button>
                  )}
                </div>
              ) : (
                <>
                  <ol className="space-y-2">
                    {userEvents.slice(0, 3).map((e) => (
                      <li key={e.id}>
                        <button type="button" onClick={() => setEvtDetailId(e.id)}
                          className="flex w-full items-start gap-2 rounded-lg border border-border bg-card/60 p-2 text-left transition active:scale-[0.99]">
                          <span className="mt-0.5">
                            {e.status === "termine" ? <CheckCircle2 className="h-4 w-4 text-success" /> :
                             e.status === "annule" ? <AlertCircle className="h-4 w-4 text-destructive" /> :
                             <Clock className="h-4 w-4 text-primary" />}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{e.title}</p>
                            <p className="truncate text-[11px] text-muted-foreground">{evtLabel(e.event_type)} · {fmtDateTime(e.start_at)}</p>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ol>
                  {userEvents.length > 3 && (
                    <Button asChild variant="ghost" size="sm" className="mt-2 h-8 w-full text-xs">
                      <Link to="/chantiers/calendrier">Voir toute la timeline ({userEvents.length})</Link>
                    </Button>
                  )}
                </>
              )}
            </Card>

            {/* Notes (mobile) — tap card */}
            <Card className="p-0">
              <button type="button"
                onClick={() => { if (d.notes.length === 0) { openNewNote(); } else { setNotesListOpen(true); } }}
                className="flex w-full items-center gap-3 p-3 text-left transition active:scale-[0.99]">
                <StickyNote className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">Notes</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {d.notes.length === 0 ? "Aucune note — Ajouter" : `${d.notes.length} note${d.notes.length > 1 ? "s" : ""}`}
                  </p>
                </div>
                {canWrite && (
                  <span className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground"><Plus className="h-4 w-4" /></span>
                )}
              </button>
              {d.notes.length > 0 && (
                <ul className="space-y-2 px-3 pb-3">
                  {d.notes.slice(0, 2).map((n) => (
                    <li key={n.id} className="rounded-lg border border-border bg-card/60 p-2 text-sm">
                      <p className="line-clamp-2 whitespace-pre-wrap break-words">{n.note}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {/* Documents (mobile) — always actionable */}
            <Card className="p-0">
              <button type="button" onClick={() => setDocsOpen(true)}
                className="flex w-full items-center gap-3 p-3 text-left transition active:scale-[0.99]">
                <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">Documents</p>
                  <p className="text-xs text-muted-foreground">{docsCount} fichier{docsCount > 1 ? "s" : ""}</p>
                </div>
                <span className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground"><Plus className="h-4 w-4" /></span>
              </button>
              {docsCount > 0 && (
                <ul className="space-y-1.5 px-3 pb-3">
                  {d.documents.slice(0, 3).map((doc) => (
                    <li key={doc.id} className="flex items-center gap-2 rounded-lg border border-border bg-card/60 p-2 text-sm">
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <a href={doc.file_url} target="_blank" rel="noreferrer" onClick={(ev) => ev.stopPropagation()} className="min-w-0 flex-1 truncate text-primary">{doc.name}</a>
                      <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>


          {/* ====== DESKTOP OVERVIEW ====== */}
          <div className="hidden space-y-6 md:block">
            {/* Résumé */}
            <Card className="grid gap-6 p-6 md:grid-cols-3">
              <div className="space-y-3 md:col-span-2">
                <div className="flex flex-wrap items-center gap-2">
                  {chColor && <span aria-hidden className="h-4 w-4 rounded-full border border-border" style={{ backgroundColor: chColor }} title="Couleur du chantier" />}
                  <StatusPill tone={statusTone} dot>{statusLabel}</StatusPill>
                  {ch.type && <StatusPill tone="neutral">{ch.type}</StatusPill>}
                  {isLocked && <StatusPill tone="neutral">🔒 Verrouillé</StatusPill>}
                </div>
                {(chReceivedAt || chClosedAt || closureOriginLabel) && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {chReceivedAt && <span>Réception : <strong className="text-foreground">{fmtDateTime(chReceivedAt)}</strong></span>}
                    {chClosedAt && <span>Clôture : <strong className="text-foreground">{fmtDateTime(chClosedAt)}</strong></span>}
                    {closureOriginLabel && <span>Origine : <strong className="text-foreground">{closureOriginLabel}</strong></span>}
                  </div>
                )}
                {ch.address && (
                  <p className="flex items-start gap-2 text-sm text-muted-foreground">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0" /> {ch.address}
                  </p>
                )}
                {ch.client && (
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <span className="inline-flex items-center gap-1 text-muted-foreground"><User className="h-3.5 w-3.5" /> {ch.client.name}</span>
                    {ch.client.email && <a href={`mailto:${ch.client.email}`} className="inline-flex items-center gap-1 text-primary hover:underline"><Mail className="h-3.5 w-3.5" /> {ch.client.email}</a>}
                    {ch.client.phone && <a href={`tel:${ch.client.phone}`} className="inline-flex items-center gap-1 text-primary hover:underline"><Phone className="h-3.5 w-3.5" /> {ch.client.phone}</a>}
                  </div>
                )}
                <div className="flex flex-wrap gap-4 text-sm">
                  <span><span className="text-muted-foreground">Début : </span><strong>{fmtDate(ch.start_date) ?? "—"}</strong></span>
                  <span><span className="text-muted-foreground">Fin prévue : </span><strong>{fmtDate(ch.end_date) ?? "—"}</strong></span>
                </div>
                {ch.description && <p className="text-sm text-muted-foreground">{ch.description}</p>}
              </div>
              <div className="space-y-4">
                <div>
                  <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                    <span>Avancement chantier</span><span className="tabular-nums">{chProgress}%</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(0, Math.min(100, chProgress))}%`, backgroundColor: chColor || "hsl(var(--primary))" }} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">Événements terminés : {stats.done} / {stats.total} ({stats.progress}%)</p>
                  <div className="mt-2"><Progress value={stats.progress} /></div>
                </div>
                {stats.upcoming && (
                  <div className="rounded-lg border border-border bg-card p-3 text-xs">
                    <p className="font-semibold text-primary">Prochain</p>
                    <p className="mt-1">{stats.upcoming.title}</p>
                    <p className="text-muted-foreground">{fmtDateTime(stats.upcoming.start_at)}</p>
                  </div>
                )}
                {stats.last && (
                  <div className="rounded-lg border border-border bg-card p-3 text-xs">
                    <p className="font-semibold">Dernier</p>
                    <p className="mt-1">{stats.last.title}</p>
                    <p className="text-muted-foreground">{fmtDateTime(stats.last.start_at)}</p>
                  </div>
                )}
              </div>
            </Card>

            {/* Grid: Timeline + side (notes, docs, history) */}
            <div className="grid gap-6 lg:grid-cols-3">
              <Card className="p-5 lg:col-span-2">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-base font-semibold">Timeline</h2>
                  {canWrite && <Button size="sm" variant="outline" onClick={openNewEvt}><Plus className="h-3.5 w-3.5" /> Ajouter</Button>}
                </div>
                {userEvents.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Aucun événement encore. Crée la première étape du chantier.</p>
                ) : (
                  <ol className="relative space-y-4 border-l border-border pl-5">
                    {userEvents.map((e) => (
                      <li key={e.id} className="relative">
                        <span className="absolute -left-[27px] grid h-5 w-5 place-items-center rounded-full border border-border bg-card">
                          {e.status === "termine" ? <CheckCircle2 className="h-3 w-3 text-success" /> :
                           e.status === "annule" ? <AlertCircle className="h-3 w-3 text-destructive" /> :
                           <Clock className="h-3 w-3 text-primary" />}
                        </span>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="font-medium leading-tight">{e.title}</p>
                            <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <StatusPill tone="neutral">{evtLabel(e.event_type)}</StatusPill>
                              <span>{fmtDateTime(e.start_at)}</span>
                              {e.location && <span>· {e.location}</span>}
                              {(e as { assigned_to?: string | null }).assigned_to && (
                                <span className="inline-flex items-center gap-1">· <User className="h-3 w-3" /> {membersById.get((e as { assigned_to: string }).assigned_to)?.name ?? "—"}</span>
                              )}
                              {(e as { reminder_at?: string | null }).reminder_at && (
                                <span className="inline-flex items-center gap-1">· <Clock className="h-3 w-3" /> Rappel {fmtDateTime((e as { reminder_at: string }).reminder_at)}</span>
                              )}
                            </p>
                            {e.description && <p className="mt-1 text-sm text-muted-foreground">{e.description}</p>}
                          </div>
                          {canWrite && (
                            <div className="flex shrink-0 gap-1">
                              <Button size="icon" variant="ghost" onClick={() => openEditEvt(e)} aria-label="Modifier"><FileText className="h-3.5 w-3.5" /></Button>
                              {isAdmin && <Button size="icon" variant="ghost" onClick={() => removeEvt(e.id)} aria-label="Supprimer"><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>}
                            </div>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </Card>

              <div className="space-y-6">
                {/* Notes */}
                <Card className="p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="inline-flex items-center gap-2 text-base font-semibold"><StickyNote className="h-4 w-4" /> Notes</h2>
                    {canWrite && (
                      <Button size="sm" variant="outline" onClick={() => setNoteOpen(true)}><Plus className="h-3.5 w-3.5" /></Button>
                    )}
                  </div>
                  {d.notes.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Aucune note.</p>
                  ) : (
                    <ul className="space-y-3">
                      {d.notes.map((n) => (
                        <li key={n.id} className="rounded-lg border border-border bg-card p-3">
                          <div className="mb-1 flex items-center gap-2 text-xs">
                            <StatusPill tone={n.priority === "high" ? "warning" : n.priority === "low" ? "neutral" : "info"}>{n.priority}</StatusPill>
                            <StatusPill tone={n.visibility === "client" ? "success" : "neutral"}>{n.visibility === "client" ? "Client" : "Interne"}</StatusPill>
                            <span className="ml-auto text-muted-foreground">{fmtDateTime(n.created_at)}</span>
                          </div>
                          <p className="whitespace-pre-wrap text-sm">{n.note}</p>
                          {isAdmin && (
                            <button onClick={() => removeNote(n.id)} className="mt-1 text-xs text-destructive hover:underline">Supprimer</button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>

                {/* Documents */}
                <Card className="p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="inline-flex items-center gap-2 text-base font-semibold"><Paperclip className="h-4 w-4" /> Documents</h2>
                  </div>
                  {canWrite && (
                    <div className="mb-3 space-y-2">
                      <Select value={docCategory} onValueChange={(v) => setDocCategory(v as typeof docCategory)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{DOC_CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                      </Select>
                      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-3 text-sm text-muted-foreground hover:border-primary hover:text-foreground">
                        <Upload className="h-4 w-4" /> {uploading ? "Envoi…" : "Ajouter un fichier"}
                        <input type="file" className="hidden" disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFileUpload(f); e.target.value = ""; }} />
                      </label>
                    </div>
                  )}
                  {d.documents.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Aucun document.</p>
                  ) : (
                    <ul className="space-y-2">
                      {d.documents.map((doc) => (
                        <li key={doc.id} className="flex items-center gap-2 rounded-lg border border-border bg-card p-2 text-sm">
                          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium">{doc.name}</p>
                            <p className="text-xs text-muted-foreground">{DOC_CATEGORIES.find((c) => c.value === doc.category)?.label ?? doc.category}</p>
                          </div>
                          <a href={doc.file_url} target="_blank" rel="noreferrer" className="text-primary hover:underline"><ExternalLink className="h-4 w-4" /></a>
                          {isAdmin && <button onClick={() => removeDoc(doc.id)} aria-label="Supprimer"><Trash2 className="h-4 w-4 text-destructive" /></button>}
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>

                {/* Activité — timeline unifiée (P2.6) */}
                <Card className="p-5">
                  <h2 className="mb-3 inline-flex items-center gap-2 text-base font-semibold"><Building2 className="h-4 w-4" /> Activité</h2>
                  {unifiedTimeline.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Aucune activité.</p>
                  ) : (
                    <ol className="space-y-3">
                      {unifiedTimeline.slice(0, 50).map((it) => (
                        <li key={it.id} className="flex items-start gap-2 text-xs">
                          <span className={
                            "mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full " +
                            (it.tone === "success" ? "bg-success" :
                             it.tone === "warning" ? "bg-warning" :
                             it.tone === "danger" ? "bg-destructive" :
                             it.tone === "info" ? "bg-primary" : "bg-muted-foreground")
                          } />
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium text-foreground">{it.title}</p>
                            <p className="text-muted-foreground">
                              {fmtDateTime(it.date)}
                              {it.subtitle && <span> · {it.subtitle}</span>}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                </Card>
              </div>
            </div>
          </div>
        </TabsContent>
        <TabsContent value="dossier" className="mt-3 md:mt-4">
          {activeCompanyId && <DossierTab companyId={activeCompanyId} chantierId={id} detail={d} onReload={reload} />}
        </TabsContent>
      </Tabs>


      {/* Event dialog */}
      <Dialog open={evtOpen} onOpenChange={setEvtOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{evtEditing ? "Modifier l'événement" : "Nouvel événement"}</DialogTitle></DialogHeader>
          <form onSubmit={saveEvt} className="space-y-3">
            <div><Label>Titre *</Label><Input required value={evtForm.title} onChange={(e) => setEvtForm({ ...evtForm, title: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Type</Label>
                <Select value={evtForm.event_type} onValueChange={(v) => setEvtForm({ ...evtForm, event_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{EVENT_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Statut</Label>
                <Select value={evtForm.status} onValueChange={(v) => setEvtForm({ ...evtForm, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{EVENT_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Début</Label><Input type="datetime-local" value={evtForm.start_at} onChange={(e) => setEvtForm({ ...evtForm, start_at: e.target.value })} /></div>
              <div><Label>Fin</Label><Input type="datetime-local" value={evtForm.end_at} onChange={(e) => setEvtForm({ ...evtForm, end_at: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Assigné à</Label>
                <Select value={evtForm.assigned_to || "none"} onValueChange={(v) => setEvtForm({ ...evtForm, assigned_to: v === "none" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="Personne" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Personne</SelectItem>
                    {members.map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Rappel</Label><Input type="datetime-local" value={evtForm.reminder_at} onChange={(e) => setEvtForm({ ...evtForm, reminder_at: e.target.value })} /></div>
            </div>
            <div><Label>Lieu</Label><Input value={evtForm.location} onChange={(e) => setEvtForm({ ...evtForm, location: e.target.value })} /></div>
            <div><Label>Description</Label><Textarea value={evtForm.description} onChange={(e) => setEvtForm({ ...evtForm, description: e.target.value })} /></div>
            <DialogFooter><Button type="submit" className="shadow-brand">Enregistrer</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Note dialog (create + edit) */}
      <Dialog open={noteOpen} onOpenChange={(o) => { setNoteOpen(o); if (!o) { setNoteEditing(null); setNoteForm(emptyNote); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{noteEditing ? "Modifier la note" : "Nouvelle note"}</DialogTitle></DialogHeader>
          <form onSubmit={saveNote} className="space-y-3">
            <Textarea required placeholder="Votre note…" value={noteForm.note} onChange={(e) => setNoteForm({ ...noteForm, note: e.target.value })} />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Visibilité</Label>
                <Select value={noteForm.visibility} onValueChange={(v) => setNoteForm({ ...noteForm, visibility: v as "internal" | "client" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="internal">Interne</SelectItem>
                    <SelectItem value="client">Visible client</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Priorité</Label>
                <Select value={noteForm.priority} onValueChange={(v) => setNoteForm({ ...noteForm, priority: v as "low" | "normal" | "high" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Basse</SelectItem>
                    <SelectItem value="normal">Normale</SelectItem>
                    <SelectItem value="high">Haute</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Rappel (optionnel)</Label>
              <Input type="datetime-local" value={noteForm.reminder_at} onChange={(e) => setNoteForm({ ...noteForm, reminder_at: e.target.value })} />
            </div>
            <DialogFooter><Button type="submit" className="shadow-brand">Enregistrer</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Notes list dialog */}
      <Dialog open={notesListOpen} onOpenChange={setNotesListOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><StickyNote className="h-4 w-4" /> Notes ({d.notes.length})</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {d.notes.map((n) => (
              <div key={n.id} className="rounded-lg border border-border bg-card p-3">
                <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                  <StatusPill size="sm" tone={n.priority === "high" ? "warning" : n.priority === "low" ? "neutral" : "info"}>{n.priority}</StatusPill>
                  <StatusPill size="sm" tone={n.visibility === "client" ? "success" : "neutral"}>{n.visibility === "client" ? "Client" : "Interne"}</StatusPill>
                  <span className="ml-auto text-muted-foreground">{fmtDateTime(n.created_at)}</span>
                </div>
                <p className="whitespace-pre-wrap break-words text-sm">{n.note}</p>
                {canWrite && (
                  <div className="mt-2 flex justify-end gap-1">
                    <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => { setNotesListOpen(false); openEditNote(n as { id: string; note: string; visibility: string; priority: string; reminder_at: string | null }); }}>
                      <Pencil className="h-3.5 w-3.5" /> Modifier
                    </Button>
                    {isAdmin && (
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive" onClick={() => removeNote(n.id)}>
                        <Trash2 className="h-3.5 w-3.5" /> Supprimer
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          <DialogFooter>
            {canWrite && (
              <Button onClick={() => { setNotesListOpen(false); openNewNote(); }} className="shadow-brand">
                <Plus className="h-4 w-4" /> Ajouter une note
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Event detail dialog */}
      <Dialog open={evtDetailId !== null} onOpenChange={(o) => { if (!o) setEvtDetailId(null); }}>
        <DialogContent className="max-w-md">
          {(() => {
            const e = userEvents.find((x) => x.id === evtDetailId);
            if (!e) return null;
            const assignedId = (e as { assigned_to?: string | null }).assigned_to ?? null;
            const reminderAt = (e as { reminder_at?: string | null }).reminder_at ?? null;
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="pr-6">{e.title}</DialogTitle>
                </DialogHeader>
                <div className="space-y-3 text-sm">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusPill tone="neutral" size="sm">{evtLabel(e.event_type)}</StatusPill>
                    <StatusPill size="sm" tone={e.status === "termine" ? "success" : e.status === "annule" ? "destructive" : e.status === "en_cours" ? "warning" : "info"}>
                      {EVENT_STATUSES.find((s) => s.value === e.status)?.label ?? e.status}
                    </StatusPill>
                  </div>
                  <div className="grid gap-1.5 text-xs">
                    <p className="flex items-center gap-2"><CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" /> Début : <strong className="font-medium text-foreground">{fmtDateTime(e.start_at)}</strong></p>
                    {e.end_at && <p className="flex items-center gap-2"><Clock className="h-3.5 w-3.5 text-muted-foreground" /> Fin : <strong className="font-medium text-foreground">{fmtDateTime(e.end_at)}</strong></p>}
                    {e.location && <p className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5 text-muted-foreground" /> {e.location}</p>}
                    {assignedId && (
                      <p className="flex items-center gap-2"><User className="h-3.5 w-3.5 text-muted-foreground" /> {membersById.get(assignedId)?.name ?? "—"}</p>
                    )}
                    {reminderAt && (
                      <p className="flex items-center gap-2"><Clock className="h-3.5 w-3.5 text-muted-foreground" /> Rappel : {fmtDateTime(reminderAt)}</p>
                    )}
                    <p className="flex items-center gap-2 text-muted-foreground"><Building2 className="h-3.5 w-3.5" /> {ch.name}</p>
                  </div>
                  {e.description && (
                    <div className="rounded-md border border-border bg-card/50 p-2 text-sm">
                      <p className="whitespace-pre-wrap break-words">{e.description}</p>
                    </div>
                  )}
                </div>
                <DialogFooter className="flex-row justify-end gap-2 sm:justify-end">
                  {canWrite && !isLocked && (
                    <>
                      <Button variant="outline" onClick={() => { setEvtDetailId(null); openEditEvt(e); }}>
                        <Pencil className="h-4 w-4" /> Modifier
                      </Button>
                      {isAdmin && (
                        <Button variant="ghost" className="text-destructive" onClick={async () => { const eid = e.id; setEvtDetailId(null); await removeEvt(eid); }}>
                          <Trash2 className="h-4 w-4" /> Supprimer
                        </Button>
                      )}
                    </>
                  )}
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Documents bottom-sheet dialog */}
      <Dialog open={docsOpen} onOpenChange={setDocsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Paperclip className="h-4 w-4" /> Documents ({docsCount})</DialogTitle>
          </DialogHeader>
          {canWrite && !isLocked && (
            <div className="space-y-2">
              <Select value={docCategory} onValueChange={(v) => setDocCategory(v as typeof docCategory)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{DOC_CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
              </Select>
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-3 text-sm text-muted-foreground hover:border-primary hover:text-foreground">
                <Upload className="h-4 w-4" /> {uploading ? "Envoi…" : "Ajouter un document"}
                <input type="file" className="hidden" disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFileUpload(f); e.target.value = ""; }} />
              </label>
            </div>
          )}
          <div className="max-h-[50vh] space-y-2 overflow-y-auto">
            {d.documents.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">Aucun document.</p>
            ) : (
              d.documents.map((doc) => (
                <div key={doc.id} className="flex items-center gap-2 rounded-lg border border-border bg-card p-2 text-sm">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{doc.name}</p>
                    <p className="text-xs text-muted-foreground">{DOC_CATEGORIES.find((c) => c.value === doc.category)?.label ?? doc.category}</p>
                  </div>
                  <a href={doc.file_url} target="_blank" rel="noreferrer" aria-label="Ouvrir" className="grid h-8 w-8 place-items-center rounded-md text-primary hover:bg-accent">
                    <ExternalLink className="h-4 w-4" />
                  </a>
                  {isAdmin && (
                    <button onClick={() => removeDoc(doc.id)} aria-label="Supprimer" className="grid h-8 w-8 place-items-center rounded-md text-destructive hover:bg-accent">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Progress dialog */}
      <Dialog open={progressOpen} onOpenChange={setProgressOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Avancement chantier</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>Auto : {stats.done}/{stats.total} événements terminés ({stats.progress}%). Vous pouvez forcer manuellement.</span>
            </p>
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">Avancement manuel</span>
              <span className="tabular-nums text-lg font-bold">{progressValue}%</span>
            </div>
            <Slider value={[progressValue]} min={0} max={100} step={1} onValueChange={(v) => setProgressValue(v[0] ?? 0)} />
            <div className="flex justify-between text-[10px] text-muted-foreground tabular-nums">
              <span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span>
            </div>
          </div>
          <DialogFooter className="flex-row gap-2 sm:justify-end">
            <Button variant="outline" onClick={() => setProgressValue(stats.progress)}>
              <Sparkles className="h-4 w-4" /> Auto ({stats.progress}%)
            </Button>
            <Button onClick={saveProgress} className="shadow-brand">Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>

  );
}

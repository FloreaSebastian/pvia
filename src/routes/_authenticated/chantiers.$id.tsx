import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, MapPin, Calendar as CalendarIcon, Plus, FileText, StickyNote, Paperclip, Clock, CheckCircle2, AlertCircle, Trash2, Building2, User, Phone, Mail, Upload, ExternalLink } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { StatusPill } from "@/components/ui/status-pill";
import { Progress } from "@/components/ui/progress";
import { PageHeader } from "@/components/app/PageHeader";
import { useServerFn } from "@tanstack/react-start";
import { useCompany } from "@/hooks/use-company";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  getChantierDetail, createChantierEvent, updateChantierEvent, deleteChantierEvent,
  createChantierNote, deleteChantierNote,
  createChantierDocument, deleteChantierDocument,
  listCompanyMembers,
} from "@/lib/chantier-detail.functions";

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
  const deleteNoteFn = useServerFn(deleteChantierNote);
  const createDocFn = useServerFn(createChantierDocument);
  const deleteDocFn = useServerFn(deleteChantierDocument);

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

  // event dialog
  const [evtOpen, setEvtOpen] = useState(false);
  const [evtEditing, setEvtEditing] = useState<string | null>(null);
  const emptyEvt = { title: "", description: "", event_type: "intervention", status: "prevu", start_at: "", end_at: "", all_day: false, location: "", color: "" };
  const [evtForm, setEvtForm] = useState(emptyEvt);
  function openNewEvt() { setEvtEditing(null); setEvtForm(emptyEvt); setEvtOpen(true); }
  function openEditEvt(e: Detail["events"][number]) {
    setEvtEditing(e.id);
    setEvtForm({
      title: e.title, description: e.description ?? "", event_type: e.event_type,
      status: e.status, start_at: e.start_at?.slice(0, 16) ?? "", end_at: e.end_at?.slice(0, 16) ?? "",
      all_day: e.all_day ?? false, location: e.location ?? "", color: e.color ?? "",
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

  // note dialog
  const [noteOpen, setNoteOpen] = useState(false);
  const emptyNote = { note: "", visibility: "internal" as "internal" | "client", priority: "normal" as "low" | "normal" | "high", reminder_at: "" };
  const [noteForm, setNoteForm] = useState(emptyNote);
  async function saveNote(e: React.FormEvent) {
    e.preventDefault();
    if (!activeCompanyId) return;
    try {
      await createNoteFn({ data: { companyId: activeCompanyId, chantierId: id, data: {
        note: noteForm.note, visibility: noteForm.visibility, priority: noteForm.priority,
        reminder_at: noteForm.reminder_at ? new Date(noteForm.reminder_at).toISOString() : null,
      } } });
      toast.success("Note ajoutée");
      setNoteOpen(false);
      setNoteForm(emptyNote);
      await reload();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Échec"); }
  }
  async function removeNote(nid: string) {
    if (!activeCompanyId || !confirm("Supprimer cette note ?")) return;
    try { await deleteNoteFn({ data: { companyId: activeCompanyId, id: nid } }); toast.success("Supprimé"); await reload(); }
    catch (err) { toast.error(err instanceof Error ? err.message : "Échec"); }
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
  const historyEvents = useMemo(() => timeline.filter((e) => e.event_type.startsWith("system_")), [timeline]);
  const userEvents = useMemo(() => timeline.filter((e) => !e.event_type.startsWith("system_")), [timeline]);

  if (loading && !d) return <div className="p-8 text-sm text-muted-foreground">Chargement…</div>;
  if (!d) return <div className="p-8 text-sm text-muted-foreground">Chantier introuvable.</div>;

  const ch = d.chantier;
  const stats = d.stats;
  const statusLabel = ch.status === "receptionne" ? "Réceptionné" : ch.status === "termine" ? "Terminé" : "En cours";
  const statusTone: "success" | "info" | "warning" = ch.status === "receptionne" ? "success" : ch.status === "termine" ? "info" : "warning";

  return (
    <div className="space-y-6">
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
            {canWrite && (
              <Button onClick={openNewEvt} className="shadow-brand">
                <Plus className="h-4 w-4" /> Nouvel événement
              </Button>
            )}
          </div>
        }
      />

      {/* Résumé */}
      <Card className="grid gap-6 p-6 md:grid-cols-3">
        <div className="space-y-3 md:col-span-2">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={statusTone} dot>{statusLabel}</StatusPill>
            {ch.type && <StatusPill tone="neutral">{ch.type}</StatusPill>}
          </div>
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
              <span>Avancement</span><span className="tabular-nums">{stats.progress}%</span>
            </div>
            <Progress value={stats.progress} />
            <p className="mt-1 text-xs text-muted-foreground">{stats.done} / {stats.total} événements terminés</p>
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
                <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
                  <DialogTrigger asChild><Button size="sm" variant="outline"><Plus className="h-3.5 w-3.5" /></Button></DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle>Nouvelle note</DialogTitle></DialogHeader>
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

          {/* Historique (system events + PVs) */}
          <Card className="p-5">
            <h2 className="mb-3 inline-flex items-center gap-2 text-base font-semibold"><Building2 className="h-4 w-4" /> Historique</h2>
            {historyEvents.length + d.pvs.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun événement automatique.</p>
            ) : (
              <ul className="space-y-2 text-xs">
                {historyEvents.map((e) => (
                  <li key={e.id} className="flex items-center gap-2 text-muted-foreground">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                    <span className="flex-1 truncate">{e.title}</span>
                    <span className="tabular-nums">{fmtDateTime(e.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

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
            <div><Label>Lieu</Label><Input value={evtForm.location} onChange={(e) => setEvtForm({ ...evtForm, location: e.target.value })} /></div>
            <div><Label>Description</Label><Textarea value={evtForm.description} onChange={(e) => setEvtForm({ ...evtForm, description: e.target.value })} /></div>
            <DialogFooter><Button type="submit" className="shadow-brand">Enregistrer</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

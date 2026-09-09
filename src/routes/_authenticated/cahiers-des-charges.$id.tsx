import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft, Loader2, FileText, Camera, Calculator, StickyNote, Send, History as HistoryIcon,
  Trash2, Download, Copy, Archive, CheckCircle2, XCircle, AlertTriangle, Upload, HardHat, Boxes,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/hooks/use-company";
import { isAdminRole, isManageRole } from "@/lib/roles";
import { VisitFieldInput } from "@/components/visites/VisitFieldInput";
import { resolveSections } from "@/lib/visites/engine";
import type { AnswerMap, AnswerValue, VisitTemplate } from "@/lib/visites/types";
import {
  getStudy, saveStudyAnswers, addStudyDocument, deleteStudyDocument, addStudyNote, deleteStudyNote,
  submitStudyForReview, reviewStudy, setStudyQuote, archiveStudy, deleteStudy,
  generateStudyPdf, sendStudyToClient, convertStudy, duplicateStudy, getStudyHistory, updateStudy,
} from "@/lib/etudes.functions";
import { getStudyTemplate } from "@/lib/etudes/templates";
import { ESTIMATE_DISCLAIMER } from "@/lib/etudes/estimate";
import { STUDY_DOC_CATEGORIES, STUDY_STATUS_META, type StudyEstimate, type StudyStatus, type StudyType } from "@/lib/etudes/types";
import {
  QUOTE_STATUSES, QUOTE_STATUS_META, computeNextAction, isProjectWon, isQuoteStatus, type QuoteStatus,
} from "@/lib/etudes/workflow";
import { STUDY_ALLOWED_MIMES, STUDY_MAX_FILE_BYTES } from "@/lib/etudes/schemas";
import { StudyStatusBadge } from "./cahiers-des-charges.index";


export const Route = createFileRoute("/_authenticated/cahiers-des-charges/$id")({
  head: () => ({
    meta: [
      { title: "Cahier des charges — PVIA" },
      { name: "description", content: "Pré-étude avant-vente : questionnaire métier, photos, estimation indicative, synthèse et envoi client." },
      { property: "og:title", content: "Cahier des charges — PVIA" },
      { property: "og:description", content: "Questionnaire métier, photos, estimation indicative et synthèse client." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: StudyDetailPage,
});

type Doc = {
  id: string; kind: string; category: string; label: string | null; description: string | null;
  storage_path: string; mime_type: string; size_bytes: number; created_at: string; url: string | null;
};
type Note = { id: string; visibility: string; body: string; created_at: string; author_id: string | null };

function StudyDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { activeCompanyId, activeRole } = useCompany();
  const canManage = isManageRole(activeRole);
  const canAdmin = isAdminRole(activeRole);

  const getFn = useServerFn(getStudy);
  const saveAnswersFn = useServerFn(saveStudyAnswers);
  const addDocFn = useServerFn(addStudyDocument);
  const delDocFn = useServerFn(deleteStudyDocument);
  const addNoteFn = useServerFn(addStudyNote);
  const delNoteFn = useServerFn(deleteStudyNote);
  const submitFn = useServerFn(submitStudyForReview);
  const reviewFn = useServerFn(reviewStudy);
  const quoteFn = useServerFn(setStudyQuote);
  const archiveFn = useServerFn(archiveStudy);
  const deleteFn = useServerFn(deleteStudy);
  const pdfFn = useServerFn(generateStudyPdf);
  const sendFn = useServerFn(sendStudyToClient);
  const convertFn = useServerFn(convertStudy);
  const duplicateFn = useServerFn(duplicateStudy);
  const historyFn = useServerFn(getStudyHistory);
  const updateFn = useServerFn(updateStudy);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [study, setStudy] = useState<Record<string, unknown> | null>(null);
  const [client, setClient] = useState<Record<string, unknown> | null>(null);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [documents, setDocuments] = useState<Doc[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [progress, setProgress] = useState<{ percent: number; missingCount: number; sections: { key: string; label: string; state: string }[] } | null>(null);
  const [estimate, setEstimate] = useState<StudyEstimate | null>(null);
  const [locked, setLocked] = useState(false);
  const [events, setEvents] = useState<{ id: string; action: string; created_at: string }[]>([]);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const pending = useRef<Map<string, { section_key: string; field_key: string; value: AnswerValue }>>(new Map());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [summary, setSummary] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [noteVisibility, setNoteVisibility] = useState<"internal" | "client">("internal");
  const [sendMessage, setSendMessage] = useState("");
  const [sendEmail, setSendEmail] = useState("");
  const [reviewComment, setReviewComment] = useState("");
  const [uploadCategory, setUploadCategory] = useState<string>(STUDY_DOC_CATEGORIES[0]);
  const [quoteForm, setQuoteForm] = useState({
    quote_status: "to_prepare" as QuoteStatus,
    quote_reference: "",
    quote_amount_ht: "",
    quote_amount_ttc: "",
    quote_sent_at: "",
    quote_expires_at: "",
    quote_comment: "",
  });

  const status = (study?.status as StudyStatus | undefined) ?? "draft";
  const rawQuoteStatus = study?.quote_status;
  const quoteStatus: QuoteStatus = isQuoteStatus(rawQuoteStatus) ? rawQuoteStatus : "to_prepare";
  const quoteAccepted = isProjectWon(quoteStatus);
  const type = (study?.study_type as StudyType | undefined) ?? "photovoltaique";
  const template = useMemo(() => getStudyTemplate(type), [type]);
  const editable = canManage && !locked && status !== "internal_review" && status !== "sent";
  const nextAction = computeNextAction({
    status,
    quote_status: quoteStatus,
    completion_percent: progress?.percent ?? 0,
    missingCount: progress?.missingCount ?? 0,
    converted_chantier_id: (study?.converted_chantier_id as string | null) ?? null,
    converted_visit_id: (study?.converted_visit_id as string | null) ?? null,
  });

  function num(v: string): number | null {
    const n = Number.parseFloat(v.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  function buildQuotePayload() {
    return {
      companyId: activeCompanyId!,
      studyId: id,
      quote_status: quoteForm.quote_status,
      quote_reference: quoteForm.quote_reference.trim() || null,
      quote_amount_ht: num(quoteForm.quote_amount_ht),
      quote_amount_ttc: num(quoteForm.quote_amount_ttc),
      quote_sent_at: quoteForm.quote_sent_at || null,
      quote_expires_at: quoteForm.quote_expires_at || null,
      quote_comment: quoteForm.quote_comment.trim() || null,
    };
  }


  const load = useCallback(async () => {
    if (!activeCompanyId) return;
    setLoading(true);
    try {
      const res = await getFn({ data: { companyId: activeCompanyId, studyId: id } });
      setStudy(res.study as Record<string, unknown>);
      setClient(res.client as Record<string, unknown> | null);
      setAnswers(res.answers as AnswerMap);
      setDocuments(res.documents as unknown as Doc[]);
      setNotes(res.notes as unknown as Note[]);
      setProgress(res.progress as never);
      setEstimate(res.estimate as StudyEstimate);
      setLocked(res.locked);
      setSummary(((res.study as Record<string, unknown>).summary as string | null) ?? "");
      setSendEmail(((res.client as Record<string, unknown> | null)?.email as string | null) ?? "");
      const s = res.study as Record<string, unknown>;
      setQuoteForm({
        quote_status: isQuoteStatus(s.quote_status) ? s.quote_status : "to_prepare",
        quote_reference: (s.quote_reference as string | null) ?? "",
        quote_amount_ht: s.quote_amount_ht == null ? "" : String(s.quote_amount_ht),
        quote_amount_ttc: s.quote_amount_ttc == null ? "" : String(s.quote_amount_ttc),
        quote_sent_at: (s.quote_sent_at as string | null) ?? "",
        quote_expires_at: (s.quote_expires_at as string | null) ?? "",
        quote_comment: (s.quote_comment as string | null) ?? "",
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Cahier des charges introuvable.");
      navigate({ to: "/cahiers-des-charges" });
    } finally {
      setLoading(false);
    }
  }, [activeCompanyId, id, getFn, navigate]);

  useEffect(() => { void load(); }, [load]);

  const flush = useCallback(async () => {
    if (!activeCompanyId || pending.current.size === 0) return;
    const entries = Array.from(pending.current.values());
    pending.current.clear();
    setSaving("saving");
    try {
      const res = await saveAnswersFn({ data: { companyId: activeCompanyId, studyId: id, entries } });
      setProgress((p) => (p ? { ...p, percent: res.completion_percent } : p));
      setEstimate(res.estimate as StudyEstimate);
      setSaving("saved");
      setTimeout(() => setSaving((v) => (v === "saved" ? "idle" : v)), 1500);
    } catch (e) {
      // Aucune saisie n'est perdue : les réponses non enregistrées repartent
      // dans la file et seront renvoyées à la prochaine tentative.
      for (const entry of entries) {
        if (!pending.current.has(entry.field_key)) pending.current.set(entry.field_key, entry);
      }
      setSaving("error");
      toast.error(e instanceof Error ? e.message : "Enregistrement impossible.");
    }
  }, [activeCompanyId, id, saveAnswersFn]);


  function onAnswer(sectionKey: string, fieldKey: string, value: AnswerValue) {
    setAnswers((a) => ({ ...a, [fieldKey]: value }));
    pending.current.set(fieldKey, { section_key: sectionKey, field_key: fieldKey, value });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 900);
  }

  const sections = useMemo(
    () => resolveSections(template as unknown as VisitTemplate, answers),
    [template, answers],
  );

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      toast.success(label);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File, kind: "photo" | "document", category: string, label?: string) {
    if (!activeCompanyId) return;
    if (!(STUDY_ALLOWED_MIMES as readonly string[]).includes(file.type)) {
      toast.error("Format non supporté (PDF, JPEG, PNG ou WebP).");
      return;
    }
    if (file.size > STUDY_MAX_FILE_BYTES) {
      toast.error("Fichier trop volumineux (max 10 Mo).");
      return;
    }
    setBusy(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
      const path = `${activeCompanyId}/etudes/${id}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("pv-assets").upload(path, file, {
        contentType: file.type,
        upsert: false,
      });
      if (error) throw new Error(error.message);
      try {
        await addDocFn({
          data: {
            companyId: activeCompanyId,
            studyId: id,
            document: {
              kind,
              category,
              label: label ?? "",
              description: "",
              storage_path: path,
              mime_type: file.type,
              size_bytes: file.size,
            },
          },
        });
      } catch (e) {
        // Compensation : sans ligne en base, le fichier stocké serait orphelin.
        await supabase.storage.from("pv-assets").remove([path]);
        throw e;
      }
      toast.success("Fichier ajouté.");
      await load();

    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Envoi impossible.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-3 p-4 lg:p-8">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }
  if (!study) return null;

  const photoDocs = documents.filter((d) => d.kind === "photo");
  const fileDocs = documents.filter((d) => d.kind !== "photo");

  return (
    <div className="mx-auto w-full max-w-5xl p-4 pb-[calc(env(safe-area-inset-bottom,0px)+5rem)] lg:p-8">
      <Button variant="ghost" className="mb-3 min-h-11 gap-2 px-2" onClick={() => navigate({ to: "/cahiers-des-charges" })}>
        <ArrowLeft className="h-4 w-4" /> Cahiers des charges
      </Button>

      <header className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">{String(study.reference)}</span>
          <StudyStatusBadge status={status} />
          <Badge variant="outline">{QUOTE_STATUS_META[quoteStatus].label}</Badge>
          <Badge variant="outline">{template.label}</Badge>
          {saving !== "idle" && (
            <span className={cn("text-xs", saving === "error" ? "text-destructive" : "text-muted-foreground")}>
              {saving === "saving" ? "Enregistrement…" : saving === "error" ? "Non enregistré — nouvel essai à la prochaine saisie" : "Enregistré"}
            </span>
          )}
          {saving === "error" && (
            <Button variant="outline" size="sm" className="min-h-9" onClick={() => void flush()}>
              Réessayer
            </Button>
          )}
        </div>
        <h1 className="mt-1 text-xl font-bold tracking-tight sm:text-2xl">
          {(study.title as string) || template.label}
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {(client?.company_name as string) || (client?.name as string) || "Client"}
          {study.site_city ? ` · ${study.site_city as string}` : ""}
        </p>
        <div className="mt-3 flex items-center gap-2">
          <Progress value={progress?.percent ?? 0} className="h-2 flex-1" />
          <span className="text-xs tabular-nums text-muted-foreground">{progress?.percent ?? 0} %</span>
        </div>
        <div className="mt-3 rounded-lg border border-border bg-muted/40 p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Prochaine action</p>
          <p className="text-sm font-medium">{nextAction.label}</p>
          <p className="text-xs text-muted-foreground">{nextAction.help}</p>
        </div>
        {(study.review_comment as string | null) && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <span>Corrections demandées : {study.review_comment as string}</span>
          </div>
        )}
        {study.study_type === "photovoltaique" && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">Modélisation 3D (Solar Studio)</p>
              <p className="text-xs text-muted-foreground">
                Toiture, obstacles et implantation photovoltaïque, conservées jusqu'au chantier.
              </p>
            </div>
            <Button asChild variant="outline" className="min-h-11">
              <Link to="/cahiers-des-charges/$id/solar-studio" params={{ id }}>
                <Boxes className="mr-2 h-4 w-4" /> Ouvrir Solar Studio
              </Link>
            </Button>
          </div>
        )}

      </header>


      <Tabs defaultValue="questionnaire">
        <TabsList className="mb-4 flex h-auto w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="questionnaire" className="min-h-11 gap-1.5"><FileText className="h-4 w-4" />Questionnaire</TabsTrigger>
          <TabsTrigger value="pieces" className="min-h-11 gap-1.5"><Camera className="h-4 w-4" />Pièces</TabsTrigger>
          <TabsTrigger value="estimation" className="min-h-11 gap-1.5"><Calculator className="h-4 w-4" />Estimation</TabsTrigger>
          <TabsTrigger value="notes" className="min-h-11 gap-1.5"><StickyNote className="h-4 w-4" />Notes</TabsTrigger>
          <TabsTrigger value="synthese" className="min-h-11 gap-1.5"><Send className="h-4 w-4" />Synthèse</TabsTrigger>
          <TabsTrigger value="historique" className="min-h-11 gap-1.5" onClick={() => {
            if (!activeCompanyId) return;
            historyFn({ data: { companyId: activeCompanyId, studyId: id } })
              .then((r) => setEvents(r.events as never))
              .catch(() => undefined);
          }}><HistoryIcon className="h-4 w-4" />Historique</TabsTrigger>
        </TabsList>

        {/* ------------------------------ Questionnaire ------------------------------ */}
        <TabsContent value="questionnaire" className="space-y-4">
          {!editable && (
            <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
              Ce cahier des charges est en lecture seule ({STUDY_STATUS_META[status].label}).
            </p>
          )}
          {sections.map(({ section, blocks }) => (
            <Card key={section.key} className="p-4">
              <h2 className="text-sm font-semibold">{section.title}</h2>
              {section.description && <p className="mt-0.5 text-xs text-muted-foreground">{section.description}</p>}
              <div className="mt-3 space-y-5">
                {blocks.map((block) => (
                  <div key={`${section.key}-${block.index ?? 0}`} className="space-y-4">
                    {block.label && <div className="text-xs font-medium text-muted-foreground">{block.label}</div>}
                    <div className="grid gap-4 sm:grid-cols-2">
                      {block.fields.map((f) => (
                        <VisitFieldInput
                          key={f.answerKey}
                          field={f}
                          value={answers[f.answerKey]}
                          disabled={!editable}
                          onChange={(v) => onAnswer(section.key, f.answerKey, v)}
                        />
                      ))}
                    </div>
                    {block.photos.length > 0 && (
                      <div className="grid gap-3 sm:grid-cols-2">
                        {block.photos.map((slot) => {
                          const existing = photoDocs.find((d) => d.label === slot.answerKey);
                          return (
                            <div key={slot.answerKey} className="rounded-lg border border-border p-3">
                              <div className="flex items-baseline gap-1 text-sm">
                                <span className="break-words">{slot.label}</span>
                                {slot.required && <span className="text-destructive">*</span>}
                              </div>
                              {existing?.url ? (
                                <div className="mt-2 space-y-2">
                                  <img src={existing.url} alt={slot.label} className="h-32 w-full rounded-md object-cover" />
                                  {editable && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="min-h-11 gap-2 text-destructive"
                                      onClick={() =>
                                        void run("Photo supprimée.", () =>
                                          delDocFn({ data: { companyId: activeCompanyId!, studyId: id, documentId: existing.id } }),
                                        )
                                      }
                                    >
                                      <Trash2 className="h-4 w-4" /> Supprimer
                                    </Button>
                                  )}
                                </div>
                              ) : editable ? (
                                <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-dashed border-input px-3 text-sm text-muted-foreground">
                                  <Camera className="h-4 w-4" /> Ajouter une photo
                                  <input
                                    type="file"
                                    accept="image/jpeg,image/png,image/webp"
                                    capture="environment"
                                    className="sr-only"
                                    onChange={(e) => {
                                      const f = e.target.files?.[0];
                                      e.target.value = "";
                                      if (f) void upload(f, "photo", slot.category ?? "Photo", slot.answerKey);
                                    }}
                                  />
                                </label>
                              ) : (
                                <p className="mt-2 text-xs text-muted-foreground">Aucune photo.</p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </TabsContent>

        {/* --------------------------------- Pièces ---------------------------------- */}
        <TabsContent value="pieces" className="space-y-4">
          {editable && (
            <Card className="space-y-3 p-4">
              <Label>Ajouter un document</Label>
              <Select value={uploadCategory} onValueChange={setUploadCategory}>
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STUDY_DOC_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
              <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-dashed border-input px-3 text-sm text-muted-foreground">
                <Upload className="h-4 w-4" /> PDF, JPEG, PNG ou WebP — 10 Mo max
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void upload(f, "document", uploadCategory);
                  }}
                />
              </label>
            </Card>
          )}
          {fileDocs.length === 0 && photoDocs.length === 0 ? (
            <Card className="p-6 text-center text-sm text-muted-foreground">Aucune pièce jointe.</Card>
          ) : (
            <ul className="space-y-2">
              {[...fileDocs, ...photoDocs].map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{d.label || d.category}</div>
                    <div className="text-xs text-muted-foreground">
                      {d.category} · {(d.size_bytes / 1024 / 1024).toFixed(2)} Mo
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {d.url && (
                      <Button asChild variant="ghost" size="icon" className="h-11 w-11">
                        <a href={d.url} target="_blank" rel="noreferrer" aria-label="Ouvrir la pièce jointe">
                          <Download className="h-4 w-4" />
                        </a>
                      </Button>
                    )}
                    {editable && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-11 w-11 text-destructive"
                        aria-label="Supprimer la pièce jointe"
                        onClick={() =>
                          void run("Pièce supprimée.", () =>
                            delDocFn({ data: { companyId: activeCompanyId!, studyId: id, documentId: d.id } }),
                          )
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        {/* ------------------------------- Estimation -------------------------------- */}
        <TabsContent value="estimation" className="space-y-4">
          <Card className="p-4">
            {estimate?.headline ? (
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">{estimate.headline.label}</div>
                <div className="text-3xl font-bold">{estimate.headline.value}</div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Complétez le questionnaire pour obtenir une estimation.</p>
            )}
            {estimate && estimate.items.length > 0 && (
              <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                {estimate.items.map((it) => (
                  <div key={it.key} className="rounded-lg border border-border p-3">
                    <dt className="text-xs text-muted-foreground">{it.label}</dt>
                    <dd className="text-sm font-medium">{it.value}</dd>
                    {it.help && <p className="mt-0.5 text-[11px] text-muted-foreground">{it.help}</p>}
                  </div>
                ))}
              </dl>
            )}
            {estimate && estimate.missing.length > 0 && (
              <div className="mt-4 rounded-lg border border-border bg-muted/40 p-3 text-sm">
                <div className="font-medium">Données manquantes</div>
                <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                  {estimate.missing.map((m) => <li key={m}>{m}</li>)}
                </ul>
              </div>
            )}
            {estimate && estimate.warnings.length > 0 && (
              <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <div className="font-medium">Points de vigilance</div>
                <ul className="mt-1 list-disc pl-5">
                  {estimate.warnings.map((w) => <li key={w}>{w}</li>)}
                </ul>
              </div>
            )}
            <p className="mt-4 text-xs text-muted-foreground">{ESTIMATE_DISCLAIMER}</p>
          </Card>
        </TabsContent>

        {/* ---------------------------------- Notes ---------------------------------- */}
        <TabsContent value="notes" className="space-y-4">
          {canManage && !locked && (
            <Card className="space-y-3 p-4">
              <Label htmlFor="note">Nouvelle note</Label>
              <Textarea id="note" value={noteBody} onChange={(e) => setNoteBody(e.target.value)} rows={3} placeholder="Contexte, échange client, point d'attention…" />
              <div className="flex flex-wrap items-center gap-2">
                <Select value={noteVisibility} onValueChange={(v) => setNoteVisibility(v as "internal" | "client")}>
                  <SelectTrigger className="h-11 w-full sm:w-56"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="internal">Note interne (jamais envoyée)</SelectItem>
                    <SelectItem value="client">Visible par le client</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  className="min-h-11"
                  disabled={busy || noteBody.trim().length === 0}
                  onClick={() =>
                    void run("Note ajoutée.", async () => {
                      await addNoteFn({ data: { companyId: activeCompanyId!, studyId: id, visibility: noteVisibility, body: noteBody } });
                      setNoteBody("");
                    })
                  }
                >
                  Ajouter
                </Button>
              </div>
            </Card>
          )}
          {notes.length === 0 ? (
            <Card className="p-6 text-center text-sm text-muted-foreground">Aucune note.</Card>
          ) : (
            <ul className="space-y-2">
              {notes.map((n) => (
                <li key={n.id} className="rounded-xl border border-border bg-card p-3">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant={n.visibility === "client" ? "secondary" : "outline"}>
                      {n.visibility === "client" ? "Client" : "Interne"}
                    </Badge>
                    {canManage && !locked && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-11 w-11 text-destructive"
                        aria-label="Supprimer la note"
                        onClick={() =>
                          void run("Note supprimée.", () =>
                            delNoteFn({ data: { companyId: activeCompanyId!, studyId: id, noteId: n.id } }),
                          )
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm">{n.body}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {new Date(n.created_at).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        {/* -------------------------------- Synthèse --------------------------------- */}
        <TabsContent value="synthese" className="space-y-4">
          <Card className="space-y-3 p-4">
            <Label htmlFor="summary">Synthèse pour le client</Label>
            <Textarea
              id="summary"
              rows={6}
              value={summary}
              disabled={!editable}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Recommandation, prochaine étape, éléments à confirmer en visite technique…"
            />
            {editable && (
              <Button
                variant="outline"
                className="min-h-11"
                disabled={busy}
                onClick={() => void run("Synthèse enregistrée.", () => updateFn({ data: { companyId: activeCompanyId!, studyId: id, summary } }))}
              >
                Enregistrer la synthèse
              </Button>
            )}
          </Card>

          <Card className="space-y-3 p-4">
            <h2 className="text-sm font-semibold">Circuit de validation</h2>
            {progress && progress.missingCount > 0 && (
              <p className="text-sm text-muted-foreground">
                {progress.missingCount} élément(s) obligatoire(s) manquant(s) avant validation.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {canManage && (status === "draft" || status === "in_progress") && (
                <Button
                  className="min-h-11 gap-2"
                  disabled={busy}
                  onClick={() => void run("Envoyé en validation interne.", () => submitFn({ data: { companyId: activeCompanyId!, studyId: id } }))}
                >
                  <CheckCircle2 className="h-4 w-4" /> Soumettre à validation
                </Button>
              )}
              {canAdmin && status === "internal_review" && (
                <>
                  <Button
                    className="min-h-11 gap-2"
                    disabled={busy}
                    onClick={() => void run("Cahier des charges validé.", () => reviewFn({ data: { companyId: activeCompanyId!, studyId: id, decision: "approve" } }))}
                  >
                    <CheckCircle2 className="h-4 w-4" /> Valider
                  </Button>
                  <div className="flex w-full flex-col gap-2 sm:flex-row">
                    <Input
                      value={reviewComment}
                      onChange={(e) => setReviewComment(e.target.value)}
                      placeholder="Corrections demandées…"
                      className="h-11"
                    />
                    <Button
                      variant="outline"
                      className="min-h-11"
                      disabled={busy}
                      onClick={() => void run("Corrections demandées.", () => reviewFn({ data: { companyId: activeCompanyId!, studyId: id, decision: "changes", comment: reviewComment } }))}
                    >
                      Demander des corrections
                    </Button>
                  </div>
                </>
              )}
            </div>
          </Card>

          <Card className="space-y-3 p-4">
            <h2 className="text-sm font-semibold">Document & envoi client</h2>
            <div className="flex flex-wrap gap-2">
              {canManage && (
                <Button
                  variant="outline"
                  className="min-h-11 gap-2"
                  disabled={busy}
                  onClick={() =>
                    void run("PDF généré.", async () => {
                      const r = await pdfFn({ data: { companyId: activeCompanyId!, studyId: id } });
                      if (r.url) window.open(r.url, "_blank", "noopener");
                    })
                  }
                >
                  <FileText className="h-4 w-4" /> Générer le PDF
                </Button>
              )}
            </div>
            {canManage && (status === "completed" || status === "sent") && (
              <div className="space-y-2">
                <Label htmlFor="send-email">E-mail du client</Label>
                <Input id="send-email" type="email" className="h-11" value={sendEmail} onChange={(e) => setSendEmail(e.target.value)} />
                <Textarea rows={3} value={sendMessage} onChange={(e) => setSendMessage(e.target.value)} placeholder="Message d'accompagnement (facultatif)" />
                <Button
                  className="min-h-11 gap-2"
                  disabled={busy}
                  onClick={() =>
                    void run("Cahier des charges envoyé au client.", () =>
                      sendFn({ data: { companyId: activeCompanyId!, studyId: id, message: sendMessage, email: sendEmail || undefined } }),
                    )
                  }
                >
                  <Send className="h-4 w-4" /> {status === "sent" ? "Renvoyer au client" : "Envoyer au client"}
                </Button>
              </div>
            )}
          </Card>

          {canManage && status !== "archived" && (
            <Card className="space-y-3 p-4">
              <div>
                <h2 className="text-sm font-semibold">Suivi du devis</h2>
                <p className="text-xs text-muted-foreground">
                  Suivi commercial facultatif. Il est indépendant du statut du cahier des charges.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="quote-status">Statut du devis</Label>
                  <Select value={quoteForm.quote_status} onValueChange={(v) => setQuoteForm((f) => ({ ...f, quote_status: v as QuoteStatus }))}>
                    <SelectTrigger id="quote-status" className="h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {QUOTE_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>{QUOTE_STATUS_META[s].label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="quote-ref">Référence du devis</Label>
                  <Input id="quote-ref" className="h-11" value={quoteForm.quote_reference} onChange={(e) => setQuoteForm((f) => ({ ...f, quote_reference: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="quote-ht">Montant HT (€)</Label>
                  <Input id="quote-ht" inputMode="decimal" className="h-11" value={quoteForm.quote_amount_ht} onChange={(e) => setQuoteForm((f) => ({ ...f, quote_amount_ht: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="quote-ttc">Montant TTC (€)</Label>
                  <Input id="quote-ttc" inputMode="decimal" className="h-11" value={quoteForm.quote_amount_ttc} onChange={(e) => setQuoteForm((f) => ({ ...f, quote_amount_ttc: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="quote-sent">Date d'envoi</Label>
                  <Input id="quote-sent" type="date" className="h-11" value={quoteForm.quote_sent_at} onChange={(e) => setQuoteForm((f) => ({ ...f, quote_sent_at: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="quote-exp">Date de validité</Label>
                  <Input id="quote-exp" type="date" className="h-11" value={quoteForm.quote_expires_at} onChange={(e) => setQuoteForm((f) => ({ ...f, quote_expires_at: e.target.value }))} />
                </div>
              </div>
              <Textarea rows={2} value={quoteForm.quote_comment} onChange={(e) => setQuoteForm((f) => ({ ...f, quote_comment: e.target.value }))} placeholder="Commentaire commercial (interne)" />
              <Button
                className="min-h-11 gap-2"
                disabled={busy}
                onClick={() => void run("Suivi commercial mis à jour.", () => quoteFn({ data: buildQuotePayload() }))}
              >
                <CheckCircle2 className="h-4 w-4" /> Enregistrer le suivi
              </Button>
            </Card>
          )}

          {canManage && status !== "archived" && (
            <Card className="space-y-3 p-4">
              <h2 className="text-sm font-semibold">Passage en production</h2>
              {!quoteAccepted ? (
                <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  Aucun chantier ni visite technique ne peut être créé tant que le devis n'est pas marqué « accepté ».
                </p>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    La visite technique crée ou réutilise le chantier lié — jamais un second.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      className="min-h-11 gap-2"
                      disabled={busy || Boolean(study.converted_visit_id)}
                      onClick={() => void run("Chantier et visite technique créés.", () => convertFn({ data: { companyId: activeCompanyId!, studyId: id, create_chantier: true, create_visit: true } }))}
                    >
                      <HardHat className="h-4 w-4" /> Créer la visite technique
                    </Button>
                    <Button
                      variant="outline"
                      className="min-h-11 gap-2"
                      disabled={busy || Boolean(study.converted_chantier_id)}
                      onClick={() => void run("Chantier créé.", () => convertFn({ data: { companyId: activeCompanyId!, studyId: id, create_chantier: true, create_visit: false } }))}
                    >
                      Créer le chantier seul
                    </Button>
                  </div>
                </>
              )}
              {(study.converted_chantier_id as string | null) && (
                <Link
                  to="/chantiers/$id"
                  params={{ id: study.converted_chantier_id as string }}
                  className="inline-flex min-h-11 items-center text-sm text-primary underline"
                >
                  Ouvrir le chantier lié
                </Link>
              )}
            </Card>
          )}


          <Card className="flex flex-wrap gap-2 p-4">
            {canManage && (
              <Button
                variant="outline"
                className="min-h-11 gap-2"
                disabled={busy}
                onClick={() =>
                  void run("Cahier des charges dupliqué.", async () => {
                    const r = await duplicateFn({ data: { companyId: activeCompanyId!, studyId: id } });
                    navigate({ to: "/cahiers-des-charges/$id", params: { id: r.id } });
                  })
                }
              >
                <Copy className="h-4 w-4" /> Dupliquer
              </Button>
            )}
            {canManage && status !== "archived" && (
              <Button
                variant="outline"
                className="min-h-11 gap-2"
                disabled={busy}
                onClick={() => void run("Cahier des charges archivé.", () => archiveFn({ data: { companyId: activeCompanyId!, studyId: id } }))}
              >
                <Archive className="h-4 w-4" /> Archiver
              </Button>
            )}
            {canAdmin && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" className="min-h-11 gap-2 text-destructive">
                    <Trash2 className="h-4 w-4" /> Supprimer
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Supprimer ce cahier des charges ?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Cette action est définitive. Les pièces jointes associées seront également supprimées.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="min-h-11">Annuler</AlertDialogCancel>
                    <AlertDialogAction
                      className="min-h-11"
                      onClick={async () => {
                        try {
                          await deleteFn({ data: { companyId: activeCompanyId!, studyId: id } });
                          toast.success("Cahier des charges supprimé.");
                          navigate({ to: "/cahiers-des-charges" });
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Suppression impossible.");
                        }
                      }}
                    >
                      Supprimer
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </Card>
        </TabsContent>

        {/* -------------------------------- Historique -------------------------------- */}
        <TabsContent value="historique">
          {events.length === 0 ? (
            <Card className="p-6 text-center text-sm text-muted-foreground">Aucun évènement enregistré.</Card>
          ) : (
            <ul className="space-y-2">
              {events.map((ev) => (
                <li key={ev.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 text-sm">
                  <span className="min-w-0 truncate">{ev.action}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {new Date(ev.created_at).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>

      <Separator className="my-6" />
      <p className={cn("text-xs text-muted-foreground", locked && "font-medium")}>
        {ESTIMATE_DISCLAIMER}
      </p>
    </div>
  );
}

import type { ComponentProps } from "react";
import { createAutosaveQueue, sendDirtySnapshot } from "@/lib/visites/autosave-queue";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, ArrowRight, Check, CloudOff, Loader2, ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { cn } from "@/lib/utils";
import { useCompany } from "@/hooks/use-company";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { applyAssistantAnswers, getTechnicalVisit, saveVisitAnswers, setVisitStatus } from "@/lib/visites.functions";
import { resolveVisitTemplate } from "@/lib/visites/templates";
import { VISIT_PHASES } from "@/lib/visites/types";
import { computeProgress, formatAnswer, resolveSections } from "@/lib/visites/engine";
import type { AnswerMap, AnswerValue } from "@/lib/visites/types";
import { VisitFieldInput } from "@/components/visites/VisitFieldInput";
import { VisitPhotoSlotCard, type VisitPhotoRow, type VisitPhotoSkipRow } from "@/components/visites/VisitPhotoSlotCard";
import { VisitAssistantSheet } from "@/components/visites/VisitAssistantSheet";
import { ensureSavedBeforeAsk, planApply, reviewCandidates } from "@/lib/visites/assistant-session";
import { VisitConstraintsPanel, type VisitConstraintRow } from "@/components/visites/VisitConstraintsPanel";
import { useBillingGate } from "@/components/billing/BillingGate";
import { classifyBillingError } from "@/lib/billing-errors";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { useAuth } from "@/hooks/use-auth";
import { findTemplateField, validateFieldValue } from "@/lib/visites/validation";
import {
  localDraftKey, planRestore, readLocalDraft, safeLocalStorage, writeLocalDraft,
  type PendingEntry, type RestorePlan,
} from "@/lib/visites/local-draft";

export const Route = createFileRoute("/_authenticated/visites-techniques/$id_/terrain")({
  head: () => ({
    meta: [
      { title: "Mode terrain — Visite technique — PVIA" },
      {
        name: "description",
        content: "Relevé terrain guidé : mesures, photos obligatoires géolocalisées et contraintes, avec enregistrement automatique.",
      },
      { property: "og:title", content: "Mode terrain — Visite technique PVIA" },
      { property: "og:description", content: "Saisie terrain mobile d'une visite technique PV ou PAC." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TerrainPage,
});

function TerrainPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { activeCompanyId } = useCompany();
  const { user } = useAuth();
  const online = useOnlineStatus();
  const { blocked: billingBlocked, reportError } = useBillingGate();
  const [syncSuspended, setSyncSuspended] = useState(false);
  const [hasUnsavedBlocked, setHasUnsavedBlocked] = useState(false);

  const getFn = useServerFn(getTechnicalVisit);
  const saveFn = useServerFn(saveVisitAnswers);
  const applyFn = useServerFn(applyAssistantAnswers);
  const statusFn = useServerFn(setVisitStatus);

  const [loading, setLoading] = useState(true);
  const [visit, setVisit] = useState<any>(null);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [photos, setPhotos] = useState<VisitPhotoRow[]>([]);
  const [skips, setSkips] = useState<VisitPhotoSkipRow[]>([]);
  const [constraints, setConstraints] = useState<VisitConstraintRow[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  /** Dernier envoi en échec (hors blocage abonnement) : affiché tant qu'il n'est pas rattrapé. */
  const [saveFailed, setSaveFailed] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [finishing, setFinishing] = useState(false);
  /** Nombre de champs saisis non encore confirmés côté serveur (mémoire écran). */
  const [pendingCount, setPendingCount] = useState(0);

  const dirtyRef = useRef<Map<string, PendingEntry>>(new Map());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Révision locale par champ : détecte une nouvelle saisie pendant une application IA. */
  const fieldRevRef = useRef<Map<string, number>>(new Map());
  /** Envoi en cours (autosave, reprise réseau ou clôture) : un seul à la fois. */
  const inFlightRef = useRef<Promise<boolean> | null>(null);
  /** Erreurs de validation par champ (client ou serveur). */
  const [fieldErrors, setFieldErrorsState] = useState<Record<string, string>>({});
  const fieldErrorsRef = useRef(fieldErrors);
  // Ref synchronisée au moment de la mise à jour (et non au rendu suivant) :
  // « Terminer » lit toujours l'état d'erreur réel.
  const setFieldErrors = useCallback((fn: (prev: Record<string, string>) => Record<string, string>) => {
    fieldErrorsRef.current = fn(fieldErrorsRef.current);
    setFieldErrorsState(fieldErrorsRef.current);
  }, []);
  const finishingRef = useRef(false);
  /** Proposition de restauration des réponses en attente retrouvées sur l'appareil. */
  const [restore, setRestore] = useState<RestorePlan | null>(null);
  const [localUnavailable, setLocalUnavailable] = useState(false);
  const storage = useMemo(() => safeLocalStorage(), []);
  const draftKey = user?.id && activeCompanyId ? localDraftKey(user.id, activeCompanyId, id) : null;

  const persistLocal = useCallback(() => {
    if (!draftKey || !visit?.visit_type) return;
    const ok = writeLocalDraft(storage, draftKey, visit.visit_type, Object.fromEntries(dirtyRef.current));
    setLocalUnavailable(!ok && dirtyRef.current.size > 0);
  }, [draftKey, storage, visit?.visit_type]);


  // Seules les réponses en attente sont copiées localement (pas de mode hors
  // connexion complet) : on avertit avant de quitter la page.
  useUnsavedGuard(
    pendingCount > 0,
    "Des réponses ne sont pas encore enregistrées. Une copie de secours reste sur cet appareil, mais quitter maintenant peut retarder leur envoi.",
  );

  const reload = useCallback(async () => {
    if (!activeCompanyId) return;
    try {
      const res = await getFn({ data: { companyId: activeCompanyId, visitId: id } });
      setVisit(res.visit);
      setAnswers((res.answers ?? {}) as AnswerMap);
      setPhotos(res.photos as VisitPhotoRow[]);
      setSkips(res.skips as VisitPhotoSkipRow[]);
      setConstraints(res.constraints as VisitConstraintRow[]);
      setCanEdit(res.canEdit);
      if (user?.id) {
        const key = localDraftKey(user.id, activeCompanyId, id);
        const draft = readLocalDraft(storage, key, res.visit.visit_type);
        if (draft) {
          const plan = planRestore(draft, (res.answers ?? {}) as AnswerMap, (res as any).answerUpdatedAt ?? {});
          const n = Object.keys(plan.restorable).length + Object.keys(plan.conflicts).length;
          if (n > 0) setRestore(plan);
          else writeLocalDraft(storage, key, res.visit.visit_type, {});
        }
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Visite introuvable");
      navigate({ to: "/visites-techniques" });
    } finally {
      setLoading(false);
    }
  }, [activeCompanyId, getFn, id, navigate, storage, user?.id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const refreshChildren = useCallback(async () => {
    if (!activeCompanyId) return;
    const res = await getFn({ data: { companyId: activeCompanyId, visitId: id } });
    setPhotos(res.photos as VisitPhotoRow[]);
    setSkips(res.skips as VisitPhotoSkipRow[]);
    setConstraints(res.constraints as VisitConstraintRow[]);
    setVisit(res.visit);
  }, [activeCompanyId, getFn, id]);

  const answersRef = useRef(answers);
  answersRef.current = answers;
  const template = useMemo(
    () => (visit ? resolveVisitTemplate(visit) : null),
    [visit],
  );
  const sections = useMemo(() => (template ? resolveSections(template, answers) : []), [template, answers]);

  const photoSlotSet = useMemo(() => new Set(photos.map((p) => p.slot_key)), [photos]);
  const skipSlotSet = useMemo(() => new Set(skips.map((s) => s.slot_key)), [skips]);

  const progress = useMemo(
    () =>
      template
        ? computeProgress(template, {
            answers,
            photoSlots: photoSlotSet,
            skippedSlots: skipSlotSet,
            constraintCount: constraints.length,
          })
        : null,
    [template, answers, photoSlotSet, skipSlotSet, constraints.length],
  );

  /** Envoie la file en attente. true = envoi réussi (la file décide s'il reste des saisies), false = échec. */
  const sendOnce = useCallback(async (): Promise<boolean> => {
    if (!activeCompanyId) return false;
    if (dirtyRef.current.size === 0) return true;
    setSaving(true);
    try {
      // Snapshot par identité : une saisie remplacée pendant l'appel reste en file.
      const { result: res, sentKeys } = await sendDirtySnapshot(dirtyRef.current as never, (entries) =>
        saveFn({ data: { companyId: activeCompanyId, visitId: id, entries: entries as never } }),
      );
      const rejected = new Map((res.fieldErrors ?? []).map((e) => [e.field_key, e.message]));
      setFieldErrors((prev) => {
        const next = { ...prev };
        for (const key of sentKeys) delete next[key];
        for (const [k, m] of rejected) next[k] = m;
        return next;
      });
      if (rejected.size > 0) toast.error("Certaines valeurs ont été refusées : corrigez les champs signalés.");
      else setSavedAt(new Date());
      setSaveFailed(false);
      setSyncSuspended(false);
      setPendingCount(dirtyRef.current.size);
      persistLocal();
      return true;
    } catch (e: any) {
      setPendingCount(dirtyRef.current.size);
      persistLocal();
      if (classifyBillingError(e)) {
        setSyncSuspended(true);
        setHasUnsavedBlocked(dirtyRef.current.size > 0);
        reportError(e);
        return false;
      }
      setSaveFailed(true);
      toast.error("Enregistrement échoué : vos dernières réponses ne sont pas sauvegardées. Touchez « Réessayer ».");
      return false;
    } finally {
      setSaving(false);
    }
  }, [activeCompanyId, id, saveFn, reportError, persistLocal, setFieldErrors]);

  /** Sérialise les envois et vide automatiquement les saisies arrivées pendant un envoi. */
  const sendOnceRef = useRef(sendOnce);
  sendOnceRef.current = sendOnce;
  const queueRef = useRef<ReturnType<typeof createAutosaveQueue> | null>(null);
  if (!queueRef.current) {
    queueRef.current = createAutosaveQueue({
      send: () => sendOnceRef.current(),
      hasPending: () => dirtyRef.current.size > 0,
    });
  }
  const flush = useCallback(async (): Promise<boolean> => {
    const run = queueRef.current!.flush();
    inFlightRef.current = run;
    try {
      return await run;
    } finally {
      if (inFlightRef.current === run) inFlightRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Reprise automatique dès que le réseau revient : sans cela les réponses
  // saisies hors connexion restaient en mémoire jusqu'à la frappe suivante.
  useEffect(() => {
    if (!online) return;
    if (dirtyRef.current.size === 0) return;
    void flush();
  }, [online, flush]);

  function onFieldChange(sectionKey: string, answerKey: string, value: AnswerValue) {
    if (finishingRef.current) return;
    fieldRevRef.current.set(answerKey, (fieldRevRef.current.get(answerKey) ?? 0) + 1);
    setAnswers((prev) => ({ ...prev, [answerKey]: value }));
    // Validation immédiate avec les mêmes règles que le serveur : une valeur
    // invalide est signalée sur le champ et n'est pas envoyée.
    const hit = template ? findTemplateField(template, answerKey) : null;
    const msg = hit ? validateFieldValue(hit.field, value) : "Champ inconnu pour ce type de visite.";
    setFieldErrors((prev) => {
      const next = { ...prev };
      if (msg) next[answerKey] = msg;
      else delete next[answerKey];
      return next;
    });
    if (msg) {
      dirtyRef.current.delete(answerKey);
      setPendingCount(dirtyRef.current.size);
      persistLocal();
      return;
    }
    dirtyRef.current.set(answerKey, { section_key: sectionKey, value, editedAt: Date.now() });
    setPendingCount(dirtyRef.current.size);
    persistLocal();
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void flush(), 900);
  }

  /**
   * Application des propositions IA (clic utilisateur) : enregistre d'abord la file en attente,
   * puis compare-and-set serveur. Les valeurs confirmées par le serveur sont intégrées
   * directement (jamais remises dans la file d'autosave, qui pourrait écraser un conflit).
   */
  async function applyAssistant(entries: Parameters<NonNullable<ComponentProps<typeof VisitAssistantSheet>["onApply"]>>[0]) {
    const plan = planApply(template, answersRef.current, entries, locked || finishingRef.current);
    if (plan.accepted.length === 0 || !activeCompanyId) return { accepted: [], rejected: plan.rejected };
    if (timerRef.current) clearTimeout(timerRef.current);
    const pre = await ensureSavedBeforeAsk({
      online: typeof navigator === "undefined" ? true : navigator.onLine,
      pending: () => dirtyRef.current.size,
      flush,
      hasFieldErrors: () => false,
    });
    if (!pre.ok) {
      return { accepted: [], rejected: plan.accepted.map((e) => ({ field_key: e.field_key, label: e.label, reason: "réponses en attente non enregistrées" })) };
    }
    const revAtSend = new Map(plan.accepted.map((e) => [e.field_key, fieldRevRef.current.get(e.field_key) ?? 0]));
    const res = await applyFn({
      data: {
        companyId: activeCompanyId,
        visitId: id,
        entries: plan.accepted.map((e) => ({ section_key: e.section_key, field_key: e.field_key, value: e.proposed, expected: e.expectedCurrent })) as never,
      },
    });
    const byKey = new Map(plan.accepted.map((e) => [e.field_key, e]));
    const applied = new Set(res.applied);
    const conflicts = new Map(res.conflicts.map((c) => [c.field_key, c.current as AnswerValue]));
    const proposed = new Map(plan.accepted.map((e) => [e.field_key, e.proposed as AnswerValue]));
    const revNow = (k: string) => fieldRevRef.current.get(k) ?? 0;
    const merged = mergeApplyResult(answersRef.current, { applied: [...applied], conflicts: [...conflicts].map(([field_key, current]) => ({ field_key, current })) }, proposed, revAtSend, revNow);
    // Fusion appliquée sur l'état le plus récent, pour les seuls champs inchangés depuis l'envoi.
    setAnswers((prev) => {
      const next = { ...prev };
      for (const k of merged.settled) next[k] = merged.answers[k];
      for (const [k] of conflicts) if (revNow(k) === (revAtSend.get(k) ?? 0)) next[k] = merged.answers[k];
      return next;
    });
    setFieldErrors((prev) => {
      const next = { ...prev };
      for (const k of merged.settled) delete next[k];
      return next;
    });
    persistLocal();
    const rejected = [...plan.rejected];
    for (const [k, v] of conflicts) {
      const e = byKey.get(k)!;
      const hit = template ? findTemplateField(template, k) : null;
      const shown = v === null || v === undefined ? "(vide)" : hit ? formatAnswer(hit.field, v) : String(v);
      rejected.push({ field_key: k, label: e.label, reason: `modifié entre-temps, valeur enregistrée : ${shown}` });
    }
    for (const f of res.fieldErrors) rejected.push({ field_key: f.field_key, label: byKey.get(f.field_key)?.label ?? f.field_key, reason: f.message });
    return { accepted: [...applied], rejected };
  }

  async function finish() {
    if (!activeCompanyId || finishingRef.current) return;
    finishingRef.current = true; // verrou synchrone : double appui et saisie bloqués
    setFinishing(true);
    try {
      if (timerRef.current) clearTimeout(timerRef.current);
      // Attend tout envoi en cours puis vide complètement la file.
      let emptied = await flush();
      for (let i = 0; i < 3 && !emptied && dirtyRef.current.size > 0; i++) emptied = await flush();
      if (dirtyRef.current.size > 0 || !emptied) {
        toast.error("Certaines réponses ne sont pas encore enregistrées. Réessayez la sauvegarde avant de terminer.");
        return;
      }
      if (Object.keys(fieldErrorsRef.current).length > 0) {
        toast.error("Des valeurs sont à corriger avant de terminer la visite.");
        return;
      }
      await statusFn({ data: { companyId: activeCompanyId, visitId: id, status: "terminee" } });
      toast.success("Visite terminée : en attente de validation.");
      navigate({ to: "/visites-techniques/$id", params: { id } });
    } catch (e: any) {
      toast.error(e?.message ?? "Clôture impossible");
    } finally {
      finishingRef.current = false;
      setFinishing(false);
      setConfirmFinish(false);
    }
  }

  function applyRestore(includeConflicts: boolean) {
    if (!restore) return;
    const chosen = { ...restore.restorable, ...(includeConflicts ? restore.conflicts : {}) };
    const now = Date.now();
    for (const [key, entry] of Object.entries(chosen)) {
      dirtyRef.current.set(key, { section_key: entry.section_key, value: entry.value, editedAt: now });
    }
    setAnswers((prev) => {
      const next = { ...prev };
      for (const [key, entry] of Object.entries(chosen)) next[key] = entry.value;
      return next;
    });
    setPendingCount(dirtyRef.current.size);
    persistLocal();
    setRestore(null);
    void flush();
    toast.success(`${Object.keys(chosen).length} réponse(s) restaurée(s), envoi en cours.`);
  }

  function discardRestore() {
    if (draftKey && visit?.visit_type) writeLocalDraft(storage, draftKey, visit.visit_type, Object.fromEntries(dirtyRef.current));
    setRestore(null);
  }

  if (loading || !template || !progress) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-3 px-3 py-4">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-2 w-full" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  const current = sections[Math.min(step, sections.length - 1)];
  const currentProgress = progress.sections.find((s) => s.key === current.section.key);
  const isLast = step >= sections.length - 1;
  const locked = !canEdit || billingBlocked || finishing;
  const errorCount = Object.keys(fieldErrors).length;

  return (
    <div className="mx-auto w-full max-w-3xl min-w-0 pb-48 lg:pb-32">
      <header className="sticky top-0 z-20 -mx-0 border-b bg-background/95 px-3 py-2 backdrop-blur sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Button asChild variant="ghost" size="icon" className="h-11 w-11 shrink-0">
            <Link to="/visites-techniques/$id" params={{ id }} aria-label="Quitter le mode terrain">
              <ArrowLeft className="h-5 w-5" aria-hidden="true" />
            </Link>
          </Button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{visit?.chantier?.name ?? "Visite technique"}</p>
            <p className="truncate text-xs text-muted-foreground">
              {visit?.reference} · {template.label}
            </p>
          </div>
          <div className="shrink-0 text-right">
            {!online ? (
              <span className="inline-flex items-center gap-1 text-xs text-amber-600">
                <CloudOff className="h-3.5 w-3.5" aria-hidden="true" />
                Hors ligne
              </span>
            ) : saving ? (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Enregistrement
              </span>
            ) : saveFailed && pendingCount > 0 ? (
              <button
                type="button"
                onClick={() => void flush()}
                className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-xs font-medium text-destructive underline-offset-2 hover:underline"
                aria-label="Échec de l'enregistrement, réessayer"
              >
                <CloudOff className="h-3.5 w-3.5" aria-hidden="true" />
                Échec · Réessayer
              </button>
            ) : pendingCount > 0 ? (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">Modifications non enregistrées</span>
            ) : savedAt ? (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                Enregistré {savedAt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
              </span>
            ) : null}
          </div>
        </div>
        {!online && pendingCount > 0 && (
          <div
            role="status"
            aria-live="polite"
            className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300"
          >
            {pendingCount} réponse{pendingCount > 1 ? "s" : ""} en attente d'enregistrement. Elles seront envoyées
            automatiquement au retour du réseau. Une copie de secours est gardée sur cet appareil et vous sera proposée si la page est rechargée ; ce n'est pas un mode hors connexion complet.
          </div>
        )}
        {(syncSuspended || billingBlocked) && (
          <div
            role="status"
            aria-live="polite"
            className="mt-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive"
          >
            {syncSuspended && hasUnsavedBlocked ? (
              <>
                Enregistrement suspendu — votre abonnement doit être activé ou régularisé. Les
                modifications que vous venez de saisir ne sont pas enregistrées : elles restent
                uniquement affichées sur cet écran et seront perdues si vous quittez la page.
              </>
            ) : (
              <>
                Mode lecture seule — enregistrement suspendu tant que votre abonnement n'est pas
                activé ou régularisé. Vos données déjà enregistrées restent consultables.
              </>
            )}
          </div>
        )}
        {restore ? (
          <div role="alert" className="mt-2 space-y-2 rounded-md border border-primary/40 bg-primary/5 p-2 text-xs">
            <p>
              {Object.keys(restore.restorable).length + Object.keys(restore.conflicts).length} réponse(s) saisie(s) sur cet
              appareil n'avaient pas été confirmées par le serveur.
              {Object.keys(restore.conflicts).length > 0
                ? ` Dont ${Object.keys(restore.conflicts).length} modifiée(s) depuis sur le serveur : la version serveur est conservée sauf choix contraire.`
                : ""}
            </p>
            <div className="flex flex-wrap gap-2">
              {Object.keys(restore.restorable).length > 0 ? (
                <Button type="button" size="sm" className="h-10" onClick={() => applyRestore(false)} disabled={locked}>
                  Restaurer
                </Button>
              ) : null}
              {Object.keys(restore.conflicts).length > 0 ? (
                <Button type="button" size="sm" variant="outline" className="h-10" onClick={() => applyRestore(true)} disabled={locked}>
                  Restaurer aussi les {Object.keys(restore.conflicts).length} modifiée(s)
                </Button>
              ) : null}
              <Button type="button" size="sm" variant="ghost" className="h-10" onClick={discardRestore}>
                Ignorer
              </Button>
            </div>
          </div>
        ) : null}
        {localUnavailable ? (
          <p className="mt-2 rounded-md bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
            Copie de secours locale indisponible sur cet appareil : ne quittez pas la page avant l'enregistrement.
          </p>
        ) : null}
        {errorCount > 0 ? (
          <p role="alert" className="mt-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
            {errorCount} valeur{errorCount > 1 ? "s" : ""} à corriger (non enregistrée{errorCount > 1 ? "s" : ""}).
          </p>
        ) : null}
        <div className="mt-2 flex items-center gap-2">
          <Progress value={progress.percent} className="h-1.5 flex-1" aria-label={`Complétude ${progress.percent}%`} />
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{progress.percent}%</span>
          {activeCompanyId ? (
            <VisitAssistantSheet
              companyId={activeCompanyId}
              visitId={id}
              phase={current.section.phase ?? null}
              sectionKey={current.section.key}
              canApply={!locked}
              key={`${activeCompanyId}:${id}`}
              beforeAsk={() => {
                if (timerRef.current) clearTimeout(timerRef.current);
                return ensureSavedBeforeAsk({
                  online: typeof navigator === "undefined" ? true : navigator.onLine,
                  pending: () => dirtyRef.current.size,
                  flush,
                  hasFieldErrors: () => Object.keys(fieldErrorsRef.current).length > 0,
                });
              }}
              review={(list) => (template ? reviewCandidates(template, answersRef.current, list) : { ok: [], rejected: list.map((c) => ({ field_key: c.field_key, label: c.label, reason: "modèle indisponible" })) })}
              onApply={applyAssistant}
              triggerClassName="h-11 shrink-0 px-3"
            />
          ) : null}
        </div>
        {current.section.phase ? (
          <ol className="mt-2 grid grid-cols-5 gap-1" aria-label="Parcours de la visite">
            {VISIT_PHASES.map((ph, pi) => {
              const idx = sections.findIndex((x) => x.section.phase === ph.key);
              const phaseSections = progress.sections.filter((ps) => sections.find((x) => x.section.key === ps.key)?.section.phase === ph.key);
              const done = ph.key === "client" || (phaseSections.length > 0 && phaseSections.every((ps) => ps.state === "complete" || ps.kind === "review"));
              const active = current.section.phase === ph.key;
              return (
                <li key={ph.key} className="min-w-0">
                  <button
                    type="button"
                    disabled={ph.key === "client" || idx === -1}
                    onClick={() => {
                      void flush();
                      if (idx >= 0) setStep(idx);
                    }}
                    aria-current={active ? "step" : undefined}
                    className={cn(
                      "flex min-h-12 w-full flex-col items-center justify-center rounded-md border px-0.5 text-center text-[10px] font-medium leading-tight sm:text-xs",
                      active ? "border-primary bg-primary text-primary-foreground" : done ? "border-emerald-300 text-emerald-700 dark:text-emerald-300" : "text-muted-foreground",
                    )}
                  >
                    <span className="tabular-nums">{pi + 1}</span>
                    <span className="line-clamp-2 break-words">{ph.label}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        ) : null}
        <div className="-mx-3 mt-2 flex gap-1 overflow-x-auto px-3 pb-1 sm:-mx-4 sm:px-4" role="tablist" aria-label="Étapes de la visite">
          {sections.map((s, i) => {
            if (current.section.phase && s.section.phase !== current.section.phase) return null;
            const st = progress.sections.find((p) => p.key === s.section.key);
            return (
              <button
                key={s.section.key}
                type="button"
                role="tab"
                aria-selected={i === step}
                onClick={() => setStep(i)}
                className={cn(
                  "min-h-11 shrink-0 rounded-full border px-3 text-xs font-medium",
                  i === step ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
                  i !== step && st?.state === "complete" && "border-emerald-300 text-emerald-700 dark:text-emerald-300",
                  i !== step && st?.state === "partial" && "border-amber-300 text-amber-700 dark:text-amber-300",
                )}
              >
                {i + 1}. {s.section.short}
              </button>
            );
          })}
        </div>
      </header>

      <div className="min-w-0 space-y-4 px-3 pt-4 sm:px-4">
        <div className="min-w-0">
          <h1 className="break-words text-lg font-semibold">{current.section.title}</h1>
          {current.section.description ? (
            <p className="mt-1 break-words text-sm text-muted-foreground">{current.section.description}</p>
          ) : null}
          {currentProgress && currentProgress.requiredFields + currentProgress.requiredPhotos > 0 ? (
            <Badge variant="outline" className="mt-2">
              {currentProgress.filledRequiredFields + currentProgress.providedPhotos} /{" "}
              {currentProgress.requiredFields + currentProgress.requiredPhotos} obligatoires
            </Badge>
          ) : null}
        </div>

        {locked && !billingBlocked ? (
          <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
            Lecture seule : cette visite est clôturée ou vous n'êtes pas assigné à sa saisie.
          </p>
        ) : null}

        {current.section.kind === "constraints" ? (
          <div className="min-w-0 space-y-4">
          {current.blocks.flatMap((b) => b.photos).length > 0 ? (
            <div className="min-w-0 space-y-2">
              <h3 className="text-sm font-semibold">1. Prenez les photos des points d'attention</h3>
              <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                {current.blocks.flatMap((b) => b.photos).map((slot) => (
                  <VisitPhotoSlotCard
                    key={slot.answerKey}
                    companyId={activeCompanyId!}
                    visitId={id}
                    sectionKey={current.section.key}
                    slot={slot}
                    photos={photos.filter((p) => p.slot_key === slot.answerKey)}
                    skip={skips.find((s) => s.slot_key === slot.answerKey) ?? null}
                    canEdit={canEdit}
                    onChanged={refreshChildren}
                  />
                ))}
              </div>
              <h3 className="pt-2 text-sm font-semibold">2. Décrivez chaque point et liez ses photos</h3>
            </div>
          ) : null}
          <VisitConstraintsPanel
            companyId={activeCompanyId!}
            visitId={id}
            sectionKey={current.section.key}
            constraints={constraints}
            canEdit={canEdit}
            onChanged={refreshChildren}
            photos={photos}
            lots={template?.lots ?? []}
          />
          </div>
        ) : current.section.kind === "review" ? (
          <div className="min-w-0 space-y-3">
            {progress.canComplete ? (
              <p className="flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
                <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="min-w-0">Tous les éléments obligatoires sont renseignés : la visite peut être clôturée.</span>
              </p>
            ) : (
              <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="min-w-0">
                  {progress.missingCount} élément{progress.missingCount > 1 ? "s" : ""} obligatoire
                  {progress.missingCount > 1 ? "s" : ""} manquant{progress.missingCount > 1 ? "s" : ""}.
                </span>
              </p>
            )}
            <ul className="space-y-2">
              {progress.sections
                .filter((s) => s.kind !== "review")
                .map((s, i) => (
                  <li key={s.key} className="min-w-0 rounded-xl border p-3">
                    <div className="flex min-w-0 items-center justify-between gap-2">
                      <p className="min-w-0 break-words text-sm font-medium">{s.title}</p>
                      <Badge
                        variant="secondary"
                        className={cn(
                          "shrink-0 border-0",
                          s.state === "complete" && "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
                          s.state === "partial" && "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
                        )}
                      >
                        {s.state === "complete" ? "Complète" : s.state === "partial" ? "Partielle" : "Vide"}
                      </Badge>
                    </div>
                    {s.missingFieldLabels.length + s.missingPhotoLabels.length > 0 ? (
                      <>
                        <ul className="mt-1.5 list-inside list-disc text-xs text-muted-foreground">
                          {[...s.missingFieldLabels, ...s.missingPhotoLabels].slice(0, 6).map((m) => (
                            <li key={m} className="break-words">
                              {m}
                            </li>
                          ))}
                        </ul>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="mt-2 h-11"
                          onClick={() => setStep(sections.findIndex((x) => x.section.key === s.key))}
                        >
                          Compléter cette étape
                        </Button>
                      </>
                    ) : null}
                  </li>
                ))}
            </ul>
          </div>
        ) : (
          <div className="min-w-0 space-y-6">
            {current.blocks.map((block) => (
              <section key={block.index ?? "single"} className="min-w-0 space-y-4">
                {block.label ? (
                  <h2 className="break-words border-b pb-1 text-sm font-semibold text-primary">{block.label}</h2>
                ) : null}
                {block.fields.length > 0 ? (
                  <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                    {block.fields.map((f) => (
                      <VisitFieldInput
                        key={f.answerKey}
                        field={f}
                        value={answers[f.answerKey]}
                        disabled={locked}
                        invalid={!!fieldErrors[f.answerKey]}
                        error={fieldErrors[f.answerKey]}
                        onChange={(v) => onFieldChange(current.section.key, f.answerKey, v)}
                      />
                    ))}
                  </div>
                ) : null}
                {block.photos.length > 0 ? (
                  <div className="min-w-0 space-y-2">
                    <h3 className="text-sm font-semibold">Photos</h3>
                    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                      {block.photos.map((slot) => (
                        <VisitPhotoSlotCard
                          key={slot.answerKey}
                          companyId={activeCompanyId!}
                          visitId={id}
                          sectionKey={current.section.key}
                          slot={slot}
                          photos={photos.filter((p) => p.slot_key === slot.answerKey)}
                          skip={skips.find((s) => s.slot_key === slot.answerKey) ?? null}
                          canEdit={canEdit}
                          onChanged={refreshChildren}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
              </section>
            ))}
          </div>
        )}
      </div>

      <nav
        aria-label="Navigation des étapes"
        className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 flex gap-2 border-t bg-background/95 p-3 backdrop-blur lg:bottom-0 lg:pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
      >
        <Button
          type="button"
          variant="outline"
          className="h-12 flex-1"
          onClick={() => {
            void flush();
            setStep((s) => Math.max(0, s - 1));
          }}
          disabled={step === 0}
        >
          <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
          Retour
        </Button>
        {isLast ? (
          <Button
            type="button"
            className="h-12 flex-1"
            onClick={() => setConfirmFinish(true)}
            disabled={locked || !progress.canComplete || errorCount > 0}
          >
            <Check className="mr-2 h-4 w-4" aria-hidden="true" />
            Terminer
          </Button>
        ) : (
          <Button
            type="button"
            className="h-12 flex-1"
            onClick={() => {
              void flush();
              setStep((s) => Math.min(sections.length - 1, s + 1));
            }}
          >
            Suivant
            <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
          </Button>
        )}
      </nav>

      <AlertDialog open={confirmFinish} onOpenChange={setConfirmFinish}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Terminer la visite ?</AlertDialogTitle>
            <AlertDialogDescription>
              La visite passera en « Terminée » et sera soumise à validation. Vous pourrez encore la compléter si elle est
              réouverte par un responsable.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <AlertDialogCancel className="h-11">Annuler</AlertDialogCancel>
            <AlertDialogAction className="h-11" onClick={finish} disabled={finishing}>
              Terminer la visite
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

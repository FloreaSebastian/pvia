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
import { getTechnicalVisit, saveVisitAnswers, setVisitStatus } from "@/lib/visites.functions";
import { getVisitTemplate, isVisitType } from "@/lib/visites/templates";
import { computeProgress, resolveSections } from "@/lib/visites/engine";
import type { AnswerMap, AnswerValue } from "@/lib/visites/types";
import { VisitFieldInput } from "@/components/visites/VisitFieldInput";
import { VisitPhotoSlotCard, type VisitPhotoRow, type VisitPhotoSkipRow } from "@/components/visites/VisitPhotoSlotCard";
import { VisitConstraintsPanel, type VisitConstraintRow } from "@/components/visites/VisitConstraintsPanel";
import { useBillingGate } from "@/components/billing/BillingGate";
import { classifyBillingError } from "@/lib/billing-errors";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";

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
  const online = useOnlineStatus();
  const { blocked: billingBlocked, reportError } = useBillingGate();
  const [syncSuspended, setSyncSuspended] = useState(false);
  const [hasUnsavedBlocked, setHasUnsavedBlocked] = useState(false);

  const getFn = useServerFn(getTechnicalVisit);
  const saveFn = useServerFn(saveVisitAnswers);
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
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [finishing, setFinishing] = useState(false);
  /** Nombre de champs saisis non encore confirmés côté serveur (mémoire écran). */
  const [pendingCount, setPendingCount] = useState(0);

  const dirtyRef = useRef<Map<string, { section_key: string; value: AnswerValue }>>(new Map());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Aucune file d'attente persistante sur l'appareil : tant qu'une saisie n'est
  // pas confirmée, quitter la page la perd. On avertit explicitement.
  useUnsavedGuard(
    pendingCount > 0,
    "Des réponses ne sont pas encore enregistrées (connexion indisponible). Quitter cette page les perdra.",
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
    } catch (e: any) {
      toast.error(e?.message ?? "Visite introuvable");
      navigate({ to: "/visites-techniques" });
    } finally {
      setLoading(false);
    }
  }, [activeCompanyId, getFn, id, navigate]);

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

  const template = useMemo(
    () => (visit && isVisitType(visit.visit_type) ? getVisitTemplate(visit.visit_type) : null),
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

  const flush = useCallback(async () => {
    if (!activeCompanyId || dirtyRef.current.size === 0) return;
    const entries = Array.from(dirtyRef.current.entries()).map(([field_key, v]) => ({
      field_key,
      section_key: v.section_key,
      value: v.value,
    }));
    dirtyRef.current.clear();
    setSaving(true);
    try {
      await saveFn({ data: { companyId: activeCompanyId, visitId: id, entries } });
      setSavedAt(new Date());
      setSyncSuspended(false);
      setPendingCount(dirtyRef.current.size);
    } catch (e: any) {
      for (const e2 of entries) dirtyRef.current.set(e2.field_key, { section_key: e2.section_key, value: e2.value });
      setPendingCount(dirtyRef.current.size);
      if (classifyBillingError(e)) {
        // Comportement réel : les saisies restent en mémoire sur cet écran,
        // mais rien n'est mis en file d'attente persistante sur l'appareil.
        setSyncSuspended(true);
        setHasUnsavedBlocked(dirtyRef.current.size > 0);
        reportError(e);
        return;
      }
      toast.error(e?.message ?? "Enregistrement différé : réessayez.");
    } finally {
      setSaving(false);
    }
  }, [activeCompanyId, id, saveFn, reportError]);

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
    setAnswers((prev) => ({ ...prev, [answerKey]: value }));
    dirtyRef.current.set(answerKey, { section_key: sectionKey, value });
    setPendingCount(dirtyRef.current.size);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void flush(), 900);
  }

  async function finish() {
    if (!activeCompanyId) return;
    setFinishing(true);
    try {
      await flush();
      await statusFn({ data: { companyId: activeCompanyId, visitId: id, status: "terminee" } });
      toast.success("Visite terminée : en attente de validation.");
      navigate({ to: "/visites-techniques/$id", params: { id } });
    } catch (e: any) {
      toast.error(e?.message ?? "Clôture impossible");
    } finally {
      setFinishing(false);
      setConfirmFinish(false);
    }
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
  const locked = !canEdit || billingBlocked;

  return (
    <div className="mx-auto w-full max-w-3xl min-w-0 pb-32">
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
            ) : savedAt ? (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                Enregistré
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
            automatiquement au retour du réseau : ne fermez pas cette page tant que la connexion n'est pas rétablie.
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
        <div className="mt-2 flex items-center gap-2">
          <Progress value={progress.percent} className="h-1.5 flex-1" aria-label={`Complétude ${progress.percent}%`} />
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{progress.percent}%</span>
        </div>
        <div className="-mx-3 mt-2 flex gap-1 overflow-x-auto px-3 pb-1 sm:-mx-4 sm:px-4" role="tablist" aria-label="Étapes de la visite">
          {sections.map((s, i) => {
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
          <VisitConstraintsPanel
            companyId={activeCompanyId!}
            visitId={id}
            sectionKey={current.section.key}
            constraints={constraints}
            canEdit={canEdit}
            onChanged={refreshChildren}
          />
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
        className="fixed inset-x-0 bottom-0 z-30 flex gap-2 border-t bg-background/95 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur"
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
            disabled={locked || !progress.canComplete || finishing}
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

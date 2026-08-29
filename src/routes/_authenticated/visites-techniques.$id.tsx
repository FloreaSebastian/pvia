import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, CalendarClock, Camera, Check, ClipboardList, HardHat, Loader2, MapPin,
  Play, Printer, RotateCcw, ShieldAlert, Trash2, User as UserIcon, Archive,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { useBlockedActionGuard } from "@/components/billing/WriteAccessGate";
import { useCompany } from "@/hooks/use-company";
import { isManageRole } from "@/lib/roles";
import { deleteTechnicalVisit, getTechnicalVisit, setVisitStatus } from "@/lib/visites.functions";
import { getVisitTemplate, isVisitType } from "@/lib/visites/templates";
import { computeProgress, resolveSections, formatAnswer } from "@/lib/visites/engine";
import { CONSTRAINT_CATEGORY_LABEL, type AnswerMap, type ConstraintCategory } from "@/lib/visites/types";
import { VisitStatusBadge, ConstraintLevelBadge } from "@/components/visites/VisitStatusBadge";
import type { VisitPhotoRow, VisitPhotoSkipRow } from "@/components/visites/VisitPhotoSlotCard";
import type { VisitConstraintRow } from "@/components/visites/VisitConstraintsPanel";

export const Route = createFileRoute("/_authenticated/visites-techniques/$id")({
  head: () => ({
    meta: [
      { title: "Dossier de visite technique — PVIA" },
      {
        name: "description",
        content: "Dossier complet d'une visite technique : relevés, photos géolocalisées, contraintes et validation.",
      },
      { property: "og:title", content: "Dossier de visite technique — PVIA" },
      { property: "og:description", content: "Relevés, photos et contraintes d'une visite technique PV ou PAC." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: VisiteDetailPage,
});

function fmt(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("fr-FR", {
    timeZone: "Europe/Paris",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function VisiteDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { activeCompanyId, activeRole } = useCompany();
  const canManage = isManageRole(activeRole);

  const getFn = useServerFn(getTechnicalVisit);
  const statusFn = useServerFn(setVisitStatus);
  const deleteFn = useServerFn(deleteTechnicalVisit);
  const { deny } = useBlockedActionGuard();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [visit, setVisit] = useState<any>(null);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [photos, setPhotos] = useState<VisitPhotoRow[]>([]);
  const [skips, setSkips] = useState<VisitPhotoSkipRow[]>([]);
  const [constraints, setConstraints] = useState<VisitConstraintRow[]>([]);
  const [assigneeName, setAssigneeName] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    if (!activeCompanyId) return;
    try {
      const res = await getFn({ data: { companyId: activeCompanyId, visitId: id } });
      setVisit(res.visit);
      setAnswers((res.answers ?? {}) as AnswerMap);
      setPhotos(res.photos as VisitPhotoRow[]);
      setSkips(res.skips as VisitPhotoSkipRow[]);
      setConstraints(res.constraints as VisitConstraintRow[]);
      setAssigneeName(res.assigneeName);
      setCanEdit(res.canEdit);
    } catch (e: any) {
      toast.error(e?.message ?? "Visite introuvable");
      navigate({ to: "/visites-techniques" });
    } finally {
      setLoading(false);
    }
  }, [activeCompanyId, getFn, id, navigate]);

  useEffect(() => {
    void load();
  }, [load]);

  const template = useMemo(
    () => (visit && isVisitType(visit.visit_type) ? getVisitTemplate(visit.visit_type) : null),
    [visit],
  );
  const sections = useMemo(() => (template ? resolveSections(template, answers) : []), [template, answers]);
  const progress = useMemo(
    () =>
      template
        ? computeProgress(template, {
            answers,
            photoSlots: new Set(photos.map((p) => p.slot_key)),
            skippedSlots: new Set(skips.map((s) => s.slot_key)),
            constraintCount: constraints.length,
          })
        : null,
    [template, answers, photos, skips, constraints.length],
  );

  async function changeStatus(status: "en_cours" | "terminee" | "validee" | "archivee" | "planifiee") {
    if (!activeCompanyId) return;
    setBusy(true);
    try {
      await statusFn({ data: { companyId: activeCompanyId, visitId: id, status } });
      toast.success("Statut mis à jour");
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Action impossible");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!activeCompanyId) return;
    setBusy(true);
    try {
      await deleteFn({ data: { companyId: activeCompanyId, visitId: id } });
      toast.success("Visite supprimée");
      navigate({ to: "/visites-techniques" });
    } catch (e: any) {
      toast.error(e?.message ?? "Suppression impossible");
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  if (loading || !template || !progress) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-3 px-3 py-4">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  const blocking = constraints.filter((c) => c.level === "bloquant").length;
  const photosByCategory = new Map<string, VisitPhotoRow[]>();
  const slotCategory = new Map<string, string>();
  for (const s of sections) {
    for (const b of s.blocks) for (const p of b.photos) slotCategory.set(p.answerKey, p.category);
  }
  for (const p of photos) {
    const cat = slotCategory.get(p.slot_key) ?? "autres";
    photosByCategory.set(cat, [...(photosByCategory.get(cat) ?? []), p]);
  }
  const orderedCategories = [
    ...template.photoCategories.filter((c) => photosByCategory.has(c)),
    ...Array.from(photosByCategory.keys()).filter((c) => !template.photoCategories.includes(c)),
  ];

  return (
    <div className="mx-auto w-full max-w-4xl min-w-0 space-y-4 px-3 pb-24 pt-3 sm:px-4 sm:pb-8">
      <div className="flex min-w-0 items-start gap-2">
        <Button asChild variant="ghost" size="icon" className="h-11 w-11 shrink-0">
          <Link to="/visites-techniques" aria-label="Retour aux visites techniques">
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">{visit.reference}</span>
            <VisitStatusBadge status={visit.status} />
            <Badge variant="outline">{template.label}</Badge>
          </div>
          <h1 className="mt-1 break-words text-lg font-semibold sm:text-xl">
            {visit.chantier?.name ?? "Visite technique"}
          </h1>
        </div>
      </div>

      <Card className="min-w-0 space-y-3 p-3 sm:p-4">
        <div className="flex items-center gap-2">
          <Progress value={visit.completion_percent ?? progress.percent} className="h-2 flex-1" aria-label="Complétude" />
          <span className="shrink-0 text-sm font-medium tabular-nums">{visit.completion_percent ?? progress.percent}%</span>
        </div>
        <dl className="grid min-w-0 grid-cols-2 gap-3 text-sm">
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">Planifiée le</dt>
            <dd className="mt-0.5 flex min-w-0 items-center gap-1 break-words">
              <CalendarClock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              {fmt(visit.scheduled_at)}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">Technicien</dt>
            <dd className="mt-0.5 flex min-w-0 items-center gap-1 break-words">
              <UserIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              {assigneeName ?? "Non assignée"}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">Adresse</dt>
            <dd className="mt-0.5 flex min-w-0 items-start gap-1 break-words">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              {visit.site_address ?? visit.chantier?.address ?? "—"}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">Chantier</dt>
            <dd className="mt-0.5 min-w-0 break-words">
              {visit.chantier?.id ? (
                <Link
                  to="/chantiers/$id"
                  params={{ id: visit.chantier.id }}
                  className="inline-flex min-w-0 items-center gap-1 underline"
                >
                  <HardHat className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{visit.chantier.reference ?? visit.chantier.name}</span>
                </Link>
              ) : (
                "—"
              )}
            </dd>
          </div>
        </dl>
        {visit.prep_notes ? (
          <p className="rounded-lg bg-muted p-2 text-sm break-words">{visit.prep_notes}</p>
        ) : null}
        {blocking > 0 ? (
          <p className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950/40 dark:text-red-200">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0">
              {blocking} point{blocking > 1 ? "s" : ""} bloquant{blocking > 1 ? "s" : ""} à lever avant travaux.
            </span>
          </p>
        ) : null}
      </Card>

      <div className="flex min-w-0 flex-wrap gap-2">
        {canEdit && visit.status !== "validee" && visit.status !== "archivee" ? (
          <Button asChild className="h-11 flex-1 min-w-[10rem]">
            <Link to="/visites-techniques/$id/terrain" params={{ id }}>
              <Play className="mr-2 h-4 w-4" aria-hidden="true" />
              {visit.status === "en_cours" ? "Continuer la saisie" : "Mode terrain"}
            </Link>
          </Button>
        ) : (
          <Button asChild variant="outline" className="h-11 flex-1 min-w-[10rem]">
            <Link to="/visites-techniques/$id/terrain" params={{ id }}>
              <ClipboardList className="mr-2 h-4 w-4" aria-hidden="true" />
              Consulter le relevé
            </Link>
          </Button>
        )}
        {canManage && visit.status === "terminee" ? (
          <Button variant="outline" className="h-11" onClick={() => { if (deny("valider la visite")) return; void changeStatus("validee"); }} disabled={busy}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="mr-2 h-4 w-4" aria-hidden="true" />}
            Valider
          </Button>
        ) : null}
        {canManage && (visit.status === "validee" || visit.status === "terminee") ? (
          <Button variant="outline" className="h-11" onClick={() => { if (deny("reprendre la visite")) return; void changeStatus("en_cours"); }} disabled={busy}>
            <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
            Réouvrir
          </Button>
        ) : null}
        <Button variant="outline" className="h-11" onClick={() => window.print()}>
          <Printer className="mr-2 h-4 w-4" aria-hidden="true" />
          Rapport
        </Button>
        {canManage && visit.status === "validee" ? (
          <Button variant="outline" className="h-11" onClick={() => { if (deny("archiver la visite")) return; void changeStatus("archivee"); }} disabled={busy}>
            <Archive className="mr-2 h-4 w-4" aria-hidden="true" />
            Archiver
          </Button>
        ) : null}
        {canManage && visit.status !== "validee" ? (
          <Button variant="ghost" className="h-11 text-destructive" onClick={() => { if (deny("supprimer la visite")) return; setConfirmDelete(true); }}>
            <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
            Supprimer
          </Button>
        ) : null}
      </div>

      <Tabs defaultValue="releve" className="min-w-0">
        <TabsList className="w-full">
          <TabsTrigger value="releve" className="min-h-11 flex-1">
            Relevé
          </TabsTrigger>
          <TabsTrigger value="photos" className="min-h-11 flex-1">
            Photos ({photos.length})
          </TabsTrigger>
          <TabsTrigger value="contraintes" className="min-h-11 flex-1">
            Contraintes ({constraints.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="releve" className="mt-3 min-w-0 space-y-4">
          {sections
            .filter((s) => (s.section.kind ?? "form") === "form")
            .map((s) => (
              <Card key={s.section.key} className="min-w-0 p-3 sm:p-4">
                <h2 className="break-words text-sm font-semibold">{s.section.title}</h2>
                {s.blocks.map((b) => (
                  <div key={b.index ?? "single"} className="mt-3 min-w-0">
                    {b.label ? <p className="text-xs font-medium text-primary">{b.label}</p> : null}
                    <dl className="mt-1 divide-y">
                      {b.fields.map((f) => (
                        <div key={f.answerKey} className="grid min-w-0 grid-cols-2 gap-2 py-1.5 text-sm">
                          <dt className="min-w-0 break-words text-muted-foreground">{f.label}</dt>
                          <dd className="min-w-0 break-words font-medium">{formatAnswer(f, answers[f.answerKey])}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ))}
              </Card>
            ))}
        </TabsContent>

        <TabsContent value="photos" className="mt-3 min-w-0 space-y-4">
          {photos.length === 0 ? (
            <Card className="flex flex-col items-center gap-2 p-6 text-center">
              <Camera className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">Aucune photo pour l'instant.</p>
            </Card>
          ) : (
            orderedCategories.map((cat) => (
              <div key={cat} className="min-w-0">
                <h2 className="text-sm font-semibold capitalize">{cat.replace(/_/g, " ")}</h2>
                <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                  {(photosByCategory.get(cat) ?? []).map((p) => (
                    <li key={p.id} className="min-w-0 overflow-hidden rounded-lg border">
                      {p.signed_url ? (
                        <a href={p.signed_url} target="_blank" rel="noreferrer">
                          <img
                            src={p.signed_url}
                            alt={p.caption ?? "Photo de visite technique"}
                            loading="lazy"
                            className="aspect-square w-full object-cover"
                          />
                        </a>
                      ) : (
                        <div className="flex aspect-square items-center justify-center bg-muted text-xs text-muted-foreground">
                          Indisponible
                        </div>
                      )}
                      <p className="break-words p-1.5 text-xs text-muted-foreground">{p.caption ?? p.slot_key}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
          {skips.length > 0 ? (
            <Card className="min-w-0 p-3">
              <h2 className="text-sm font-semibold">Photos non réalisées</h2>
              <ul className="mt-2 space-y-1 text-sm">
                {skips.map((s) => (
                  <li key={s.id} className="min-w-0 break-words text-muted-foreground">
                    <span className="font-medium text-foreground">{s.slot_key}</span> — {s.justification}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </TabsContent>

        <TabsContent value="contraintes" className="mt-3 min-w-0 space-y-2">
          {constraints.length === 0 ? (
            <Card className="p-6 text-center text-sm text-muted-foreground">Aucune contrainte signalée.</Card>
          ) : (
            constraints.map((c) => (
              <Card key={c.id} className="min-w-0 p-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <ConstraintLevelBadge level={c.level} />
                  <span className="text-xs text-muted-foreground">
                    {CONSTRAINT_CATEGORY_LABEL[c.category as ConstraintCategory] ?? c.category}
                  </span>
                </div>
                <p className="mt-1.5 break-words text-sm font-medium">{c.title}</p>
                {c.description ? <p className="mt-1 break-words text-sm text-muted-foreground">{c.description}</p> : null}
                {c.recommendation ? (
                  <p className="mt-1 break-words text-sm">
                    <span className="font-medium">Préconisation : </span>
                    {c.recommendation}
                  </p>
                ) : null}
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette visite ?</AlertDialogTitle>
            <AlertDialogDescription>
              Les relevés, photos et contraintes seront définitivement supprimés. Le chantier associé est conservé.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <AlertDialogCancel className="h-11">Annuler</AlertDialogCancel>
            <AlertDialogAction className="h-11 bg-destructive text-destructive-foreground" onClick={remove} disabled={busy}>
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

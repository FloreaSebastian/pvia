import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Boxes, Loader2, RotateCcw, Save, Sparkles, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCompany } from "@/hooks/use-company";
import { isManageRole } from "@/lib/roles";
import {
  createSolarModel,
  createSolarVersion,
  clearSolarLayout,
  deleteSolarObstacle,
  generateSolarLayout,
  getSolarModel,
  saveSolarBuilding,
  saveSolarObstacle,
  saveSolarRoofPlanes,
  convertRoofToEditable,
  toggleSolarModule,
  updateSolarModel,
  type SolarModelPayload,
} from "@/lib/solar.functions";
import {
  DEFAULT_BUILDING_PARAMS,
  OBSTACLE_META,
  ROOF_TYPE_META,
  SOLAR_QUALITY_META,
  type BuildingParams,
  type ObstacleType,
  type RoofType,
  type SolarQualityLevel,
} from "@/lib/solar/types";
import {
  buildLayoutSummary,
  deriveStudioSteps,
  formatArea,
  formatKwc,
  type SaveState,
  type StudioMode,
  type StudioStepId,
} from "@/lib/solar/studio-steps";
import { azimuthLabel, type LocalPoint } from "@/lib/solar/geo";
import {
  groundToPlaneUv,
  nextPlaneKey,
  nextPlaneName,
  parseCustomPlanes,
  planeFromCustom,
  type CustomRoofPlane,
} from "@/lib/solar/polygon";
import { RoofPlanesPanel } from "@/components/solar/roof/RoofEditor";
import type { RoofDrawTool } from "@/components/solar/map/GoogleMapView";
import { buildSceneModel } from "@/components/solar/scene-model";
import { PlanView } from "@/components/solar/PlanView";
import { SmartLayoutPanel, type LayoutPreview } from "@/components/solar/SmartLayoutPanel";
import { SitePanel } from "@/components/solar/SitePanel";
import { SiteMapCard } from "@/components/solar/map/SiteMapCard";
import { StepRail } from "@/components/solar/studio/StepRail";
import { StudioTopBar } from "@/components/solar/studio/StudioTopBar";
import { ContextPanel } from "@/components/solar/studio/ContextPanel";
import { LayoutSummaryBar } from "@/components/solar/studio/LayoutSummaryBar";
import {
  ManualLayoutEditor,
  type ManualEditorState,
} from "@/components/solar/manual/ManualLayoutEditor";
import { ManualSelectionPanel } from "@/components/solar/manual/ManualSelectionPanel";

const SolarScene = lazy(() => import("@/components/solar/SolarScene"));

export const Route = createFileRoute("/_authenticated/cahiers-des-charges/$id_/solar-studio")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Solar Studio — modélisation 3D | PVIA" },
      {
        name: "description",
        content:
          "Jumeau numérique solaire : toiture paramétrique, obstacles, implantation photovoltaïque et synthèse rattachées au cahier des charges.",
      },
      { property: "og:title", content: "Solar Studio — modélisation 3D | PVIA" },
      {
        property: "og:description",
        content: "Modélisation 3D du bâtiment et implantation photovoltaïque.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SolarStudioPage,
});

type Payload = NonNullable<SolarModelPayload>;
type LayoutContext = { targetKwc: number | null; moduleSelected: boolean; planeNames: string[] };

/** Emprise tracée sur la carte, en attente du choix de type et de propriétés. */
type ObstacleDraft = {
  roofPlaneId: string;
  planeName: string;
  position_x_m: number;
  position_y_m: number;
  width_m: number;
  length_m: number;
};
type ObstacleDraftValues = {
  obstacle_type: ObstacleType;
  label: string;
  height_m: number;
  clearance_m: number;
};

/** Types proposés au tracé d'une emprise sur la carte. */
const DRAFT_OBSTACLE_TYPES: ObstacleType[] = [
  "velux",
  "cheminee",
  "ventilation",
  "mur",
  "climatisation",
  "chien_assis",
  "autre",
];

function SolarStudioPage() {
  const { id } = useParams({ from: "/_authenticated/cahiers-des-charges/$id_/solar-studio" });
  const { activeCompanyId: companyId, activeRole } = useCompany();
  const canWrite = isManageRole(activeRole);

  const load = useServerFn(getSolarModel);
  const create = useServerFn(createSolarModel);
  const saveBuilding = useServerFn(saveSolarBuilding);
  const saveObstacle = useServerFn(saveSolarObstacle);
  const removeObstacle = useServerFn(deleteSolarObstacle);
  const runLayout = useServerFn(generateSolarLayout);
  const clearLayout = useServerFn(clearSolarLayout);
  const toggleModule = useServerFn(toggleSolarModule);
  const saveMeta = useServerFn(updateSolarModel);
  const saveRoofPlanes = useServerFn(saveSolarRoofPlanes);
  const convertRoof = useServerFn(convertRoofToEditable);
  const snapshot = useServerFn(createSolarVersion);

  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [params, setParams] = useState<BuildingParams>(DEFAULT_BUILDING_PARAMS);
  const [selectedPlaneKey, setSelectedPlaneKey] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState(false);

  // Cadre UX P0-A : étape courante, mode rapide/expert, panneau contextuel.
  const [step, setStep] = useState<StudioStepId>("projet");
  const [mode, setMode] = useState<StudioMode>("rapide");
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [layoutContext, setLayoutContext] = useState<LayoutContext>({
    targetKwc: null,
    moduleSelected: false,
    planeNames: [],
  });
  // P0-A.1 : état d'écriture remonté par les panneaux enfants (Site, Implantation).
  const [childSave, setChildSave] = useState<Record<string, { busy: boolean; error: boolean }>>({});
  const reportChildSave = useCallback(
    (source: string) => (state: { busy: boolean; error: boolean }) =>
      setChildSave((prev) =>
        prev[source]?.busy === state.busy && prev[source]?.error === state.error
          ? prev
          : { ...prev, [source]: state },
      ),
    [],
  );
  const onSiteSave = useMemo(() => reportChildSave("site"), [reportChildSave]);
  const onLayoutSave = useMemo(() => reportChildSave("implantation"), [reportChildSave]);
  const childBusy = Object.values(childSave).some((s) => s.busy);
  const childError = Object.values(childSave).some((s) => s.error);

  // Historique local des paramètres de bâtiment (annuler / rétablir).
  const history = useRef<BuildingParams[]>([]);
  const future = useRef<BuildingParams[]>([]);
  const [historyTick, setHistoryTick] = useState(0);
  const [visualMode, setVisualMode] = useState<"map" | "3d">("map");

  // Étape Toiture (P0-B) : outil actif et pans dessinés, historique dédié.
  const [roofTool, setRoofTool] = useState<RoofDrawTool>("select");
  const [roofPlanes, setRoofPlanes] = useState<CustomRoofPlane[]>([]);
  const [roofDirty, setRoofDirty] = useState(false);
  const roofHistory = useRef<CustomRoofPlane[][]>([]);
  const roofFuture = useRef<CustomRoofPlane[][]>([]);
  // P0-B.1 : brouillon d'obstacle (type et propriétés choisis avant écriture)
  // et sortie d'étape protégée quand des pans ne sont pas enregistrés.
  const [obstacleDraft, setObstacleDraft] = useState<ObstacleDraft | null>(null);
  /** Aperçu de la variante comparée : affichage seul, jamais enregistré. */
  const [layoutPreview, setLayoutPreview] = useState<LayoutPreview | null>(null);
  const [pendingStep, setPendingStep] = useState<StudioStepId | null>(null);
  // Édition manuelle (P0-D) : brouillon local, jamais écrit avant « Enregistrer ».
  const [manualEditing, setManualEditing] = useState(false);
  const [manualState, setManualState] = useState<ManualEditorState | null>(null);
  /** Dialogue de sortie du brouillon manuel ; `target` = étape à rejoindre. */
  const [manualLeave, setManualLeave] = useState<{ target: StudioStepId | null } | null>(null);

  const applyPayload = useCallback((next: Payload) => {
    setPayload(next);
    setParams(next.params);
    setRoofPlanes(
      parseCustomPlanes(next.building?.custom_planes, {
        tilt_deg: next.params.tilt_deg,
        eave_height_m: next.params.wall_height_m,
      }),
    );
    setRoofDirty(false);
    setSelectedPlaneKey((prev) => prev ?? next.planes[0]?.key ?? null);
  }, []);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    setLoading(true);
    load({ data: { companyId, studyId: id } })
      .then((res) => {
        if (cancelled) return;
        if (res) applyPayload(res as Payload);
      })
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Chargement impossible."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [companyId, id, load, applyPayload]);

  // Fermeture d'onglet avec des contours OU des corrections manuelles non
  // enregistrés : avertissement natif du navigateur.
  const manualDirty = manualEditing && !!manualState?.dirty;
  const warnUnload = shouldWarnBeforeUnload({
    step,
    roofDirty,
    manualEditing,
    manualDirty: !!manualState?.dirty,
  });
  /** Intercepte une sortie du studio quand un brouillon n'est pas enregistré. */
  const blockLeave = () => {
    const decision = decideLeaveStudio({
      step,
      roofDirty,
      manualEditing,
      manualDirty: !!manualState?.dirty,
    });
    if (decision.action === "confirm-manual") {
      setManualLeave({ target: null });
      return true;
    }
    if (decision.action === "confirm-roof") {
      setPendingStep("implantation");
      return true;
    }
    return false;
  };
  useEffect(() => {
    if (!warnUnload) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [warnUnload, roofDirty, manualDirty]);

  const guard = async (fn: () => Promise<Payload>, success?: string) => {
    if (!canWrite) {
      toast.error("Droits insuffisants.");
      return;
    }
    setBusy(true);
    try {
      const next = await fn();
      applyPayload(next);
      setSaveError(false);
      if (success) toast.success(success);
    } catch (e) {
      setSaveError(true);
      toast.error(e instanceof Error ? e.message : "Action impossible.");
    } finally {
      setBusy(false);
    }
  };

  const patchParams = (patch: Partial<BuildingParams>) => {
    history.current = [...history.current.slice(-49), params];
    future.current = [];
    setHistoryTick((t) => t + 1);
    setParams((p) => ({ ...p, ...patch }));
    setDirty(true);
  };

  const persistParams = async (next: BuildingParams) => {
    if (!companyId || !payload) return;
    await guard(
      async () =>
        (await saveBuilding({
          data: {
            companyId,
            modelId: payload.model.id,
            params: next,
            // Détection de conflit : refus serveur si le modèle a changé ailleurs.
            expectedGeometryVersion: payload.model.geometry_version,
          },
        })) as Payload,
      "Bâtiment enregistré.",
    );
    setDirty(false);
  };

  const undo = async () => {
    const prev = history.current.pop();
    if (!prev) return;
    future.current.push(params);
    setParams(prev);
    setHistoryTick((t) => t + 1);
    await persistParams(prev);
  };

  const redo = async () => {
    const next = future.current.pop();
    if (!next) return;
    history.current.push(params);
    setParams(next);
    setHistoryTick((t) => t + 1);
    await persistParams(next);
  };

  /* ----------------------------- Toiture P0-B ---------------------------- */

  /**
   * Un bâtiment encore décrit par ses dimensions ne peut pas recevoir de contour
   * dessiné : il faut d'abord la conversion explicite, qui conserve les pans et
   * l'implantation. Le serveur applique la même règle.
   */
  const polygonMode = payload?.building?.geometry_mode === "polygon";

  /** Enregistre le jeu complet de pans dessinés : écriture atomique côté serveur. */
  const persistRoofPlanes = async (planes: CustomRoofPlane[], success?: string) => {
    if (!companyId || !payload) return;
    await guard(
      async () =>
        (await saveRoofPlanes({
          data: {
            companyId,
            modelId: payload.model.id,
            planes,
            expectedGeometryVersion: payload.model.geometry_version,
          },
        })) as Payload,
      success,
    );
  };

  /** Modification locale + historique. L'écriture serveur reste explicite. */
  const updateRoofPlanes = (
    next: CustomRoofPlane[],
    options?: { persist?: boolean; success?: string },
  ) => {
    roofHistory.current = [...roofHistory.current.slice(-49), roofPlanes];
    roofFuture.current = [];
    setHistoryTick((t) => t + 1);
    setRoofPlanes(next);
    if (options?.persist) void persistRoofPlanes(next, options.success);
    else setRoofDirty(true);
  };

  const undoRoof = () => {
    const prev = roofHistory.current.pop();
    if (!prev) return;
    roofFuture.current.push(roofPlanes);
    setHistoryTick((t) => t + 1);
    setRoofPlanes(prev);
    void persistRoofPlanes(prev);
  };

  const redoRoof = () => {
    const next = roofFuture.current.pop();
    if (!next) return;
    roofHistory.current.push(roofPlanes);
    setHistoryTick((t) => t + 1);
    setRoofPlanes(next);
    void persistRoofPlanes(next);
  };

  /** Nouveau pan dessiné : nommage automatique, pente/orientation par défaut. */
  const handlePlaneDrawn = (ring: LocalPoint[]) => {
    if (!payload) return;
    if (!polygonMode) {
      setRoofTool("select");
      toast.error(
        "Convertissez d'abord la toiture en contours éditables : la conversion conserve les pans et l'implantation.",
      );
      return;
    }

    const key = nextPlaneKey([
      ...roofPlanes.map((p) => p.key),
      ...payload.planes.map((p) => p.key),
    ]);
    const plane: CustomRoofPlane = {
      key,
      name: nextPlaneName(roofPlanes.map((p) => p.name)),
      ring,
      tilt_deg: params.tilt_deg,
      azimuth_deg: params.azimuth_deg,
      eave_height_m: params.wall_height_m,
      margin_m: 0.4,
      edge_margins: [],
    };
    setSelectedPlaneKey(key);
    setRoofTool("select");
    updateRoofPlanes([...roofPlanes, plane], {
      persist: true,
      success: `${plane.name} enregistré.`,
    });
  };

  /** Sommet déplacé ou inséré : écriture uniquement en fin de geste. */
  const handleRingChange = (key: string, ring: LocalPoint[]) => {
    updateRoofPlanes(
      roofPlanes.map((p) => (p.key === key ? { ...p, ring } : p)),
      { persist: true },
    );
  };

  /**
   * Emprise d'obstacle tracée sur la carte : on prépare un brouillon, rien n'est
   * enregistré tant que l'utilisateur n'a pas choisi le type et les propriétés.
   */
  const handleObstacleDrawn = (ring: LocalPoint[]) => {
    if (!companyId || !payload) return;
    const plane = roofPlanes.find((p) => p.key === selectedPlaneKey);
    const planeRow = payload.planes.find((p) => p.key === selectedPlaneKey);
    if (!plane || !planeRow) {
      toast.error("Sélectionnez d'abord le pan qui porte cet obstacle.");
      return;
    }
    const uv = ring.map((p) => groundToPlaneUv(p, plane.azimuth_deg, plane.tilt_deg));
    const us = uv.map((p) => p.x);
    const vs = uv.map((p) => p.y);
    const width = Math.max(...us) - Math.min(...us);
    const length = Math.max(...vs) - Math.min(...vs);
    if (width < 0.05 || length < 0.05) {
      toast.error("Emprise trop petite : agrandissez le rectangle de l'obstacle.");
      return;
    }
    setObstacleDraft({
      roofPlaneId: planeRow.id,
      planeName: planeRow.name,
      position_x_m: (Math.max(...us) + Math.min(...us)) / 2,
      position_y_m: (Math.max(...vs) + Math.min(...vs)) / 2,
      width_m: Math.min(100, width),
      length_m: Math.min(100, length),
    });
    setRoofTool("select");
  };

  /** Le brouillon d'obstacle n'est écrit qu'après validation explicite. */
  const commitObstacleDraft = (values: ObstacleDraftValues) => {
    if (!companyId || !payload || !obstacleDraft) return;
    const draft = obstacleDraft;
    setObstacleDraft(null);
    void guard(
      async () =>
        (await saveObstacle({
          data: {
            companyId,
            modelId: payload.model.id,
            roofPlaneId: draft.roofPlaneId,
            obstacle_type: values.obstacle_type,
            label: values.label || OBSTACLE_META[values.obstacle_type].label,
            position_x_m: draft.position_x_m,
            position_y_m: draft.position_y_m,
            width_m: draft.width_m,
            length_m: draft.length_m,
            height_m: values.height_m,
            clearance_m: values.clearance_m,
            expectedGeometryVersion: payload.model.geometry_version,
          },
        })) as Payload,
      "Obstacle ajouté.",
    );
  };

  const handleLayoutContext = useCallback((ctx: LayoutContext) => {
    setLayoutContext((prev) =>
      prev.targetKwc === ctx.targetKwc &&
      prev.moduleSelected === ctx.moduleSelected &&
      prev.planeNames.join("|") === ctx.planeNames.join("|")
        ? prev
        : ctx,
    );
  }, []);

  const scene = useMemo(() => (payload ? buildSceneModel(payload) : null), [payload]);
  const selectedPlane = useMemo(
    () => payload?.planes.find((p) => p.key === selectedPlaneKey) ?? null,
    [payload, selectedPlaneKey],
  );

  const steps = useMemo(
    () =>
      deriveStudioSteps({
        activeStep: step,
        hasAddress: Boolean(payload?.model.address),
        hasGeolocation: payload?.model.latitude != null,
        planeCount: payload?.planes.length ?? 0,
        roofAreaM2: payload?.summary.roof_area_m2 ?? 0,
        moduleSelected: layoutContext.moduleSelected || (payload?.summary.module_count ?? 0) > 0,
        moduleCount: payload?.summary.module_count ?? 0,
        powerKwc: payload?.summary.power_kwc ?? 0,
        targetKwc: layoutContext.targetKwc,
      }),
    [step, payload, layoutContext],
  );
  const currentStep = steps.find((s) => s.id === step)!;

  const layoutSummary = useMemo(() => {
    const usedPlanes = payload
      ? payload.planes
          .filter((p) => payload.modules.some((m) => m.roof_plane_key === p.key && m.enabled))
          .map((p) => p.name)
      : [];
    return buildLayoutSummary({
      moduleCount: payload?.summary.module_count ?? 0,
      powerKwc: payload?.summary.power_kwc ?? 0,
      moduleAreaM2: payload?.summary.module_area_m2 ?? null,
      targetKwc: layoutContext.targetKwc,
      planeNames: usedPlanes.length ? usedPlanes : layoutContext.planeNames,
      alerts: payload && payload.planes.length === 0 ? ["Aucun pan de toiture défini."] : [],
    });
  }, [payload, layoutContext]);

  if (loading) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-[50vh] w-full" />
      </div>
    );
  }

  if (!payload) {
    return (
      <div className="mx-auto max-w-xl space-y-4 p-4">
        <BackLink id={id} />
        <Card className="space-y-4 p-6 text-center">
          <Boxes className="mx-auto h-10 w-10 text-primary" aria-hidden />
          <h1 className="text-xl font-semibold">Solar Studio</h1>
          <p className="text-sm text-muted-foreground">
            Créez la modélisation 3D du bâtiment. Elle reste rattachée à ce dossier et sera enrichie
            à chaque étape, jusqu'au chantier.
          </p>
          <Button
            className="min-h-11 w-full"
            disabled={!canWrite || busy || !companyId}
            onClick={() =>
              companyId &&
              guard(
                async () => (await create({ data: { companyId, studyId: id } })) as Payload,
                "Modélisation créée.",
              )
            }
          >
            {busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-4 w-4" />
            )}
            Créer la modélisation
          </Button>
          {!canWrite && (
            <p className="text-xs text-muted-foreground">
              Votre rôle ne permet pas de créer la modélisation.
            </p>
          )}
        </Card>
      </div>
    );
  }

  const summary = payload.summary;
  const specForPlane = selectedPlane ? scene?.specByPlaneKey[selectedPlane.key] : undefined;
  // Agrégation : une écriture d'un panneau enfant doit se voir dans la barre haute,
  // tout comme des contours de toiture modifiés mais pas encore enregistrés.
  const saveState: SaveState =
    busy || childBusy || manualState?.saveState === "saving"
      ? "enregistrement"
      : saveError || childError || manualState?.saveState === "error"
        ? "erreur"
        : dirty || roofDirty || (manualEditing && !!manualState?.dirty)
          ? "modifie"
          : "enregistre";

  const showPlanView = step === "modules" || step === "implantation";

  /**
   * Changement d'étape : on protège les contours de toiture non enregistrés ET
   * le brouillon d'édition manuelle. Un seul dialogue pertinent à la fois.
   */
  const requestStep = (next: StudioStepId) => {
    const decision = decideStepChange(
      { step, roofDirty, manualEditing, manualDirty: !!manualState?.dirty },
      next,
    );
    if (decision.action === "confirm-roof") {
      setPendingStep(next);
      return;
    }
    if (decision.action === "confirm-manual") {
      setManualLeave({ target: next });
      return;
    }
    if (manualEditing) {
      setManualEditing(false);
      setManualState(null);
    }
    setStep(next);
  };

  const onToggleModuleAt = (moduleId: string) => {
    const current = payload.modules.find((m) => m.id === moduleId);
    if (!current || !companyId) return;
    void guard(
      async () =>
        (await toggleModule({
          data: { companyId, modelId: payload.model.id, moduleId, enabled: !current.enabled },
        })) as Payload,
    );
  };

  return (
    <div className="flex min-h-[560px] flex-col overflow-hidden rounded-lg border bg-background xl:h-[calc(100dvh-7rem)]">
      <StudioTopBar
        studyId={id}
        title={payload.model.name || "Solar Studio"}
        subtitle={
          `${payload.model.address ?? ""} ${payload.model.postal_code ?? ""} ${payload.model.city ?? ""}`.trim() ||
          "Adresse à renseigner"
        }
        saveState={saveState}
        mode={mode}
        onModeChange={setMode}
        visualMode={visualMode}
        onVisualModeChange={setVisualMode}
        canUndo={
          manualEditing
            ? !!manualState?.canUndo
            : step === "toiture"
              ? roofHistory.current.length > 0 && !busy
              : !busy && history.current.length > 0
        }
        canRedo={
          manualEditing
            ? !!manualState?.canRedo
            : step === "toiture"
              ? roofFuture.current.length > 0 && !busy
              : !busy && future.current.length > 0
        }
        onUndo={() =>
          manualEditing ? manualState?.undo() : step === "toiture" ? undoRoof() : void undo()
        }
        onRedo={() =>
          manualEditing ? manualState?.redo() : step === "toiture" ? redoRoof() : void redo()
        }
        help={currentStep.hint}
      />

      <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
        <StepRail steps={steps} activeStep={step} onSelect={requestStep} />

        {/* Canevas prioritaire */}
        <main className="flex min-h-[48vh] min-w-0 flex-1 flex-col xl:min-h-0">
          <p className="border-b bg-muted/40 px-3 py-1 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{currentStep.primaryAction}</span> —{" "}
            {currentStep.hint}
          </p>

          {step === "toiture" && (
            <p className="border-b bg-muted/20 px-3 py-1 text-xs text-muted-foreground sm:hidden">
              Pour dessiner précisément la toiture, utilisez le mode paysage ou une tablette. La
              consultation reste possible ici.
            </p>
          )}

          <div className="relative min-h-[240px] flex-1 overflow-hidden">
            {step === "implantation" && manualEditing && companyId ? (
              <ManualLayoutEditor
                companyId={companyId}
                modelId={payload.model.id}
                planeKey={selectedPlaneKey}
                onPlaneKeyChange={setSelectedPlaneKey}
                onState={setManualState}
                onSaved={() => {
                  if (!companyId) return;
                  void load({ data: { companyId, studyId: id } }).then((next) =>
                    applyPayload(next as Payload),
                  );
                }}
                onExit={() => {
                  if (manualState?.dirty) setManualLeave({ target: null });
                  else {
                    setManualEditing(false);
                    setManualState(null);
                  }
                }}
              />
            ) : visualMode === "map" && companyId ? (
              <ClientOnly fallback={<Skeleton className="h-full w-full" />}>
                <SiteMapCard
                  payload={payload}
                  companyId={companyId}
                  disabled={!canWrite || busy}
                  selectedPlaneKey={selectedPlaneKey}
                  onSelectPlane={setSelectedPlaneKey}
                  onPayload={applyPayload}
                  roofEditor={
                    step === "toiture"
                      ? {
                          tool: roofTool,
                          onToolChange: setRoofTool,
                          editableRings: roofPlanes.map((p) => ({
                            key: p.key,
                            name: p.name,
                            ring: p.ring,
                          })),
                          disabled: !canWrite || busy,
                          canDraw: polygonMode,
                          drawLockedReason:
                            "Toiture décrite par ses dimensions : convertissez-la en contours éditables pour dessiner. Les pans et l'implantation existants sont conservés.",
                          canUndo: roofHistory.current.length > 0 && !busy,
                          canRedo: roofFuture.current.length > 0 && !busy,
                          onUndo: undoRoof,
                          onRedo: redoRoof,
                          onPlaneDrawn: handlePlaneDrawn,
                          onRingChange: handleRingChange,
                          onObstacleDrawn: handleObstacleDrawn,
                        }
                      : undefined
                  }
                />
              </ClientOnly>
            ) : (
              <ClientOnly fallback={<Skeleton className="h-full w-full" />}>
                <Suspense fallback={<Skeleton className="h-full w-full" />}>
                  {scene && (
                    <SolarScene
                      model={scene}
                      selectedPlaneKey={selectedPlaneKey}
                      onSelectPlane={setSelectedPlaneKey}
                      onToggleModule={onToggleModuleAt}
                    />
                  )}
                </Suspense>
              </ClientOnly>
            )}

            {obstacleDraft && (
              <ObstacleDraftCard
                draft={obstacleDraft}
                onCancel={() => setObstacleDraft(null)}
                onConfirm={commitObstacleDraft}
              />
            )}
          </div>

          {showPlanView && !manualEditing && (
            <div className="hidden h-[26vh] min-h-[180px] border-t p-2 xl:block">
              <PlanView
                plane={selectedPlane ?? null}
                modules={payload.modules}
                obstacles={scene?.obstacles ?? []}
                spec={specForPlane}
                onToggleModule={onToggleModuleAt}
                preview={step === "implantation" ? (layoutPreview?.modules ?? null) : null}
              />
            </div>
          )}

          {step === "implantation" && <LayoutSummaryBar summary={layoutSummary} />}
        </main>

        <ContextPanel
          title={currentStep.label}
          action={currentStep.primaryAction}
          collapsed={panelCollapsed}
          onToggle={() => setPanelCollapsed((c) => !c)}
        >
          {step === "projet" && (
            <div className="space-y-3">
              <SitePanel
                payload={payload}
                companyId={companyId}
                disabled={!canWrite || busy}
                onPayload={applyPayload}
                onSaveActivity={onSiteSave}
              />
              {mode === "expert" && (
                <Card className="space-y-2 p-3">
                  <Label>Niveau de fiabilité du modèle</Label>
                  <Select
                    value={payload.model.quality_level}
                    onValueChange={(v) =>
                      companyId &&
                      void guard(
                        async () =>
                          (await saveMeta({
                            data: {
                              companyId,
                              modelId: payload.model.id,
                              quality_level: v as SolarQualityLevel,
                            },
                          })) as Payload,
                        "Niveau mis à jour.",
                      )
                    }
                  >
                    <SelectTrigger className="min-h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(SOLAR_QUALITY_META) as SolarQualityLevel[]).map((q) => (
                        <SelectItem key={q} value={q}>
                          {SOLAR_QUALITY_META[q].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {SOLAR_QUALITY_META[payload.model.quality_level as SolarQualityLevel].help}
                  </p>
                </Card>
              )}
            </div>
          )}

          {step === "toiture" && (
            <div className="space-y-3">
              <Card className="space-y-3 p-3">
                <div className="space-y-1.5">
                  <Label>Type de toiture</Label>
                  <Select
                    value={params.roof_type}
                    onValueChange={(v) => patchParams({ roof_type: v as RoofType })}
                  >
                    <SelectTrigger className="min-h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(ROOF_TYPE_META) as RoofType[]).map((t) => (
                        <SelectItem key={t} value={t}>
                          {ROOF_TYPE_META[t].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <NumField
                    label="Largeur (m)"
                    value={params.width_m}
                    step={0.1}
                    onChange={(v) => patchParams({ width_m: v })}
                  />
                  <NumField
                    label="Profondeur (m)"
                    value={params.depth_m}
                    step={0.1}
                    onChange={(v) => patchParams({ depth_m: v })}
                  />
                  <NumField
                    label="Hauteur mur (m)"
                    value={params.wall_height_m}
                    step={0.1}
                    onChange={(v) => patchParams({ wall_height_m: v })}
                  />
                  <NumField
                    label="Pente (°)"
                    value={params.tilt_deg}
                    step={1}
                    onChange={(v) => patchParams({ tilt_deg: v })}
                  />
                  {mode === "expert" && (
                    <>
                      <NumField
                        label="Azimut (°)"
                        value={params.azimuth_deg}
                        step={5}
                        onChange={(v) => patchParams({ azimuth_deg: v })}
                      />
                      <NumField
                        label="Débord (m)"
                        value={params.overhang_m}
                        step={0.05}
                        onChange={(v) => patchParams({ overhang_m: v })}
                      />
                    </>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Azimut {Math.round(params.azimuth_deg)}° — pan principal orienté{" "}
                  {azimuthLabel(params.azimuth_deg)}.
                </p>
                {roofPlanes.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Les pans dessinés sur la carte font foi : ces dimensions restent enregistrées
                    mais ne définissent plus la toiture.
                  </p>
                )}
                <Button
                  className="min-h-11 w-full"
                  disabled={!canWrite || busy || !dirty}
                  onClick={() => void persistParams(params)}
                >
                  {busy ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  Enregistrer la toiture
                </Button>
              </Card>

              {roofPlanes.length > 0 ? (
                <>
                  <RoofPlanesPanel
                    planes={roofPlanes}
                    selectedKey={selectedPlaneKey}
                    expert={mode === "expert"}
                    disabled={!canWrite || busy}
                    onSelect={setSelectedPlaneKey}
                    onChange={(key, patch) =>
                      updateRoofPlanes(
                        roofPlanes.map((p) => (p.key === key ? { ...p, ...patch } : p)),
                      )
                    }
                    onDuplicate={(key) => {
                      const source = roofPlanes.find((p) => p.key === key);
                      if (!source) return;
                      const newKey = nextPlaneKey(roofPlanes.map((p) => p.key));
                      updateRoofPlanes(
                        [
                          ...roofPlanes,
                          {
                            ...source,
                            key: newKey,
                            name: nextPlaneName(roofPlanes.map((p) => p.name)),
                            // Décalage visible pour que le contour copié soit saisissable.
                            ring: source.ring.map((v) => ({ x: v.x + 2, y: v.y + 2 })),
                          },
                        ],
                        { persist: true, success: "Contour dupliqué." },
                      );
                      setSelectedPlaneKey(newKey);
                    }}
                    onDelete={(key) => {
                      const plane = roofPlanes.find((p) => p.key === key);
                      if (!plane) return;
                      const placed = payload.modules.filter((m) => m.roof_plane_key === key).length;
                      const question = placed
                        ? `Supprimer ${plane.name} ? ${placed} panneau(x) y sont posés.`
                        : `Supprimer ${plane.name} ?`;
                      if (!window.confirm(question)) return;
                      updateRoofPlanes(
                        roofPlanes.filter((p) => p.key !== key),
                        { persist: true, success: "Pan supprimé." },
                      );
                      setSelectedPlaneKey(null);
                    }}
                  />
                  <Button
                    className="min-h-11 w-full"
                    disabled={!canWrite || busy || !roofDirty}
                    onClick={() => void persistRoofPlanes(roofPlanes, "Pans enregistrés.")}
                  >
                    {busy ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="mr-2 h-4 w-4" />
                    )}
                    Enregistrer les pans
                  </Button>
                </>
              ) : (
                <Card className="divide-y p-0">
                  {payload.planes.map((plane) => (
                    <button
                      key={plane.key}
                      type="button"
                      onClick={() => setSelectedPlaneKey(plane.key)}
                      className={`flex min-h-11 w-full items-center justify-between gap-2 p-3 text-left ${
                        plane.key === selectedPlaneKey ? "bg-accent" : ""
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{plane.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {azimuthLabel(plane.azimuth_deg)} · {Math.round(plane.tilt_deg)}° ·{" "}
                          {plane.area_m2.toFixed(1)} m²
                        </span>
                      </span>
                      <Badge variant="outline">
                        {
                          payload.modules.filter((m) => m.roof_plane_key === plane.key && m.enabled)
                            .length
                        }
                      </Badge>
                    </button>
                  ))}
                  {!payload.planes.length && (
                    <p className="p-3 text-xs text-muted-foreground">
                      Aucun pan pour l'instant. Dessinez le contour de la toiture sur la carte.
                    </p>
                  )}
                  {payload.planes.length > 0 && (
                    <div className="space-y-2 p-3">
                      <p className="text-xs text-muted-foreground">
                        Cette toiture vient des dimensions saisies. Convertissez-la en contours pour
                        corriger chaque angle sur la carte : les paramètres actuels restent
                        enregistrés.
                      </p>
                      <Button
                        variant="secondary"
                        className="min-h-11 w-full"
                        disabled={!canWrite || busy || !companyId}
                        onClick={() =>
                          companyId &&
                          void guard(
                            async () =>
                              (await convertRoof({
                                data: {
                                  companyId,
                                  modelId: payload.model.id,
                                  expectedGeometryVersion: payload.model.geometry_version,
                                },
                              })) as Payload,
                            "Toiture convertie en contours éditables.",
                          )
                        }
                      >
                        Convertir en contours éditables
                      </Button>
                    </div>
                  )}
                </Card>
              )}

              {mode === "expert" && (
                <ObstaclePanel
                  payload={payload}
                  selectedPlaneId={selectedPlane?.id ?? null}
                  disabled={!canWrite || busy || !companyId}
                  onAdd={(values) =>
                    companyId &&
                    void guard(
                      async () =>
                        (await saveObstacle({
                          data: {
                            companyId,
                            modelId: payload.model.id,
                            ...values,
                            expectedGeometryVersion: payload.model.geometry_version,
                          },
                        })) as Payload,
                      "Obstacle ajouté.",
                    )
                  }
                  onDelete={(obstacleId) =>
                    companyId &&
                    void guard(
                      async () =>
                        (await removeObstacle({
                          data: {
                            companyId,
                            modelId: payload.model.id,
                            obstacleId,
                            expectedGeometryVersion: payload.model.geometry_version,
                          },
                        })) as Payload,
                      "Obstacle supprimé.",
                    )
                  }
                />
              )}
            </div>
          )}

          {step === "modules" && (
            <LayoutPanel
              payload={payload}
              planeId={selectedPlane?.id ?? null}
              disabled={!canWrite || busy || !companyId}
              onRun={(values) =>
                companyId &&
                selectedPlane &&
                void guard(
                  async () =>
                    (await runLayout({
                      data: {
                        companyId,
                        modelId: payload.model.id,
                        roofPlaneId: selectedPlane.id,
                        ...values,
                      },
                    })) as Payload,
                  "Pose calculée.",
                )
              }
              onClear={() =>
                companyId &&
                selectedPlane &&
                void guard(
                  async () =>
                    (await clearLayout({
                      data: { companyId, modelId: payload.model.id, roofPlaneId: selectedPlane.id },
                    })) as Payload,
                  "Pose supprimée.",
                )
              }
            />
          )}

          {step === "implantation" && manualEditing && (
            <ManualSelectionPanel state={manualState} expert={mode === "expert"} />
          )}

          {step === "implantation" && !manualEditing && (
            <>
              <Button
                className="mb-3 min-h-11 w-full"
                disabled={!canWrite || busy || !companyId || summary.module_count === 0}
                onClick={() => setManualEditing(true)}
              >
                Modifier manuellement
              </Button>
              {summary.module_count === 0 && (
                <p className="mb-3 text-xs text-muted-foreground">
                  Appliquez d'abord une implantation pour pouvoir la corriger à la main.
                </p>
              )}
            </>
          )}

          {step === "implantation" && !manualEditing && (
            <SmartLayoutPanel
              companyId={companyId}
              modelId={payload.model.id}
              planes={payload.planes.map((p) => ({
                id: p.id,
                key: p.key,
                name: p.name,
                area_m2: p.area_m2,
              }))}
              disabled={!canWrite || busy}
              onContextChange={handleLayoutContext}
              onPreview={setLayoutPreview}
              onSaveActivity={onLayoutSave}
              onApplied={() => {
                if (!companyId) return;
                void load({ data: { companyId, studyId: id } }).then((next) =>
                  applyPayload(next as Payload),
                );
              }}
            />
          )}

          {step === "electrique" && (
            <Card className="space-y-2 p-4 text-center">
              <Zap className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
              <p className="text-sm font-medium">Étude électrique à venir</p>
              <p className="text-xs text-muted-foreground">
                Onduleurs, chaînes et protections seront définis ici. L'implantation validée servira
                de base : rien n'est estimé tant que cette étape n'est pas disponible.
              </p>
            </Card>
          )}

          {step === "resultats" && (
            <div className="space-y-3">
              <Card className="grid grid-cols-2 gap-3 p-3">
                <Metric label="Panneaux" value={String(summary.module_count)} />
                <Metric label="Puissance" value={formatKwc(summary.power_kwc)} />
                <Metric label="Surface toiture" value={formatArea(summary.roof_area_m2)} />
                <Metric
                  label="Orientation"
                  value={
                    summary.main_azimuth_deg == null
                      ? "—"
                      : `${azimuthLabel(summary.main_azimuth_deg)} · ${summary.main_tilt_deg}°`
                  }
                />
              </Card>
              <Button
                variant="outline"
                className="min-h-11 w-full"
                disabled={!canWrite || busy || !companyId}
                onClick={() =>
                  companyId &&
                  void guard(
                    async () =>
                      (await snapshot({
                        data: { companyId, modelId: payload.model.id, label: "" },
                      })) as Payload,
                    "Version enregistrée.",
                  )
                }
              >
                Figer une version ({payload.versions.length})
              </Button>
              <p className="text-xs text-muted-foreground">
                Modèle géométrique déclaratif : les dimensions restent à confirmer lors de la visite
                technique.
              </p>
              <BackLink id={id} blocked={blockLeave} />
            </div>
          )}

          <p className="mt-3 text-[11px] text-muted-foreground xl:hidden">
            Sur petit écran, préférez le mode paysage ou une tablette pour l'édition détaillée du
            plan.
          </p>
        </ContextPanel>
      </div>

      {manualLeave && manualState && (
        <LeaveManualDialog
          busy={manualState.saveState === "saving"}
          onSave={() => {
            const target = manualLeave.target;
            void manualState.requestSave().then((ok) => {
              // Enregistrement échoué : on reste en édition, l'étape ne change pas.
              const outcome = resolveManualLeave("save", ok);
              if (!outcome.proceed) return;
              setManualLeave(null);
              setManualEditing(false);
              setManualState(null);
              if (target) setStep(target);
            });
          }}
          onDiscard={() => {
            const target = manualLeave.target;
            resolveManualLeave("discard");
            manualState.discardDraft();
            setManualLeave(null);
            setManualEditing(false);
            setManualState(null);
            if (target) setStep(target);
          }}
          onStay={() => setManualLeave(null)}
        />
      )}

      {pendingStep && (
        <LeaveRoofDialog
          busy={busy}
          onSave={async () => {
            const target = pendingStep;
            setPendingStep(null);
            await persistRoofPlanes(roofPlanes, "Toiture enregistrée.");
            setStep(target);
          }}
          onDiscard={() => {
            const target = pendingStep;
            setPendingStep(null);
            setRoofPlanes(
              parseCustomPlanes(payload.building?.custom_planes, {
                tilt_deg: params.tilt_deg,
                eave_height_m: params.wall_height_m,
              }),
            );
            setRoofDirty(false);
            setStep(target);
          }}
          onStay={() => setPendingStep(null)}
        />
      )}
      <p className="sr-only">{historyTick}</p>
    </div>
  );
}

/** Sortie de l'édition manuelle avec des corrections non enregistrées. */
function LeaveManualDialog({
  busy,
  onSave,
  onDiscard,
  onStay,
}: {
  busy?: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onStay: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Corrections manuelles non enregistrées"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4"
    >
      <Card className="w-full max-w-sm space-y-3 p-4">
        <p className="text-sm font-semibold">Modifications non enregistrées</p>
        <p className="text-xs text-muted-foreground">
          Vos corrections de panneaux ne sont pas encore enregistrées.
        </p>
        <div className="flex flex-col gap-2">
          <Button className="min-h-11" disabled={busy} onClick={onSave}>
            {busy ? "Enregistrement…" : "Enregistrer et continuer"}
          </Button>
          <Button variant="outline" className="min-h-11" disabled={busy} onClick={onDiscard}>
            Abandonner les modifications
          </Button>
          <Button variant="ghost" className="min-h-11" onClick={onStay}>
            Rester en édition
          </Button>
        </div>
      </Card>
    </div>
  );
}

/** Sortie de l'étape Toiture avec des contours non enregistrés. */
function LeaveRoofDialog({
  busy,
  onSave,
  onDiscard,
  onStay,
}: {
  busy: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onStay: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Modifications de toiture non enregistrées"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4"
    >
      <Card className="w-full max-w-sm space-y-3 p-4">
        <p className="text-sm font-semibold">Contours de toiture non enregistrés</p>
        <p className="text-xs text-muted-foreground">
          Vos modifications de contours ne sont pas encore enregistrées. Que souhaitez-vous faire ?
        </p>
        <div className="flex flex-col gap-2">
          <Button className="min-h-11" disabled={busy} onClick={onSave}>
            Enregistrer et continuer
          </Button>
          <Button variant="outline" className="min-h-11" disabled={busy} onClick={onDiscard}>
            Abandonner les modifications
          </Button>
          <Button variant="ghost" className="min-h-11" onClick={onStay}>
            Rester sur la toiture
          </Button>
        </div>
      </Card>
    </div>
  );
}

/** Choix du type et des propriétés avant l'enregistrement d'un obstacle tracé. */
function ObstacleDraftCard({
  draft,
  onConfirm,
  onCancel,
}: {
  draft: ObstacleDraft;
  onConfirm: (values: ObstacleDraftValues) => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState<ObstacleType>("velux");
  const [label, setLabel] = useState("");
  const [height, setHeight] = useState(OBSTACLE_META["velux"].defaultHeight);
  const [clearance, setClearance] = useState(0.3);

  return (
    <Card className="absolute bottom-3 left-3 z-30 w-[min(20rem,calc(100%-1.5rem))] space-y-2 p-3 shadow-lg">
      <p className="text-sm font-semibold">Nouvel obstacle sur {draft.planeName}</p>
      <p className="text-xs text-muted-foreground">
        {draft.width_m.toFixed(2)} × {draft.length_m.toFixed(2)} m — précisez le type avant
        enregistrement.
      </p>
      <div className="space-y-1.5">
        <Label className="text-xs">Type</Label>
        <Select
          value={type}
          onValueChange={(v) => {
            const next = v as ObstacleType;
            setType(next);
            setHeight(OBSTACLE_META[next].defaultHeight);
          }}
        >
          <SelectTrigger className="min-h-11">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DRAFT_OBSTACLE_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {OBSTACLE_META[t].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Nom (facultatif)</Label>
        <Input
          className="min-h-11"
          value={label}
          placeholder={OBSTACLE_META[type].label}
          onChange={(e) => setLabel(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <NumField label="Hauteur (m)" value={height} step={0.1} onChange={setHeight} />
        <NumField label="Marge (m)" value={clearance} step={0.1} onChange={setClearance} />
      </div>
      <div className="flex gap-2">
        <Button
          className="min-h-11 flex-1"
          onClick={() =>
            onConfirm({
              obstacle_type: type,
              label: label.trim(),
              height_m: Math.max(0, Math.min(50, height)),
              clearance_m: Math.max(0, Math.min(10, clearance)),
            })
          }
        >
          Ajouter
        </Button>
        <Button variant="ghost" className="min-h-11" onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </Card>
  );
}

/**
 * Retour au cahier des charges. `blocked` intercepte la navigation quand un
 * brouillon (toiture ou panneaux) n'est pas enregistré.
 */
function BackLink({ id, blocked }: { id: string; blocked?: () => boolean }) {
  return (
    <Link
      to="/cahiers-des-charges/$id"
      params={{ id }}
      className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      onClick={(e) => {
        if (blocked?.()) e.preventDefault();
      }}
    >
      <ArrowLeft className="h-4 w-4" /> Retour au cahier des charges
    </Link>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      <p className="truncate text-base font-semibold">{value}</p>
    </div>
  );
}

function NumField({
  label,
  value,
  step,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        inputMode="decimal"
        step={step}
        value={value}
        className="min-h-11"
        onChange={(e) => {
          const n = Number(e.target.value.replace(",", "."));
          if (Number.isFinite(n)) onChange(n);
        }}
      />
    </div>
  );
}

function ObstaclePanel({
  payload,
  selectedPlaneId,
  disabled,
  onAdd,
  onDelete,
}: {
  payload: Payload;
  selectedPlaneId: string | null;
  disabled: boolean;
  onAdd: (values: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
}) {
  const [type, setType] = useState<ObstacleType>("cheminee");
  const [u, setU] = useState(1);
  const [v, setV] = useState(1);
  const [w, setW] = useState(0.6);
  const [l, setL] = useState(0.6);
  const [h, setH] = useState(OBSTACLE_META.cheminee.defaultHeight);
  const [clearance, setClearance] = useState(0.3);

  return (
    <Card className="space-y-3 p-3">
      <div className="space-y-1.5">
        <Label>Type d'obstacle</Label>
        <Select
          value={type}
          onValueChange={(val) => {
            const t = val as ObstacleType;
            setType(t);
            setH(OBSTACLE_META[t].defaultHeight);
          }}
        >
          <SelectTrigger className="min-h-11">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(OBSTACLE_META) as ObstacleType[]).map((t) => (
              <SelectItem key={t} value={t}>
                {OBSTACLE_META[t].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <NumField label="Position le long de l'égout (m)" value={u} step={0.1} onChange={setU} />
        <NumField label="Position dans la pente (m)" value={v} step={0.1} onChange={setV} />
        <NumField label="Largeur (m)" value={w} step={0.05} onChange={setW} />
        <NumField label="Longueur (m)" value={l} step={0.05} onChange={setL} />
        <NumField label="Hauteur (m)" value={h} step={0.05} onChange={setH} />
        <NumField
          label="Marge de sécurité (m)"
          value={clearance}
          step={0.05}
          onChange={setClearance}
        />
      </div>
      <Button
        className="min-h-11 w-full"
        disabled={disabled || !selectedPlaneId}
        onClick={() =>
          onAdd({
            roofPlaneId: selectedPlaneId,
            obstacle_type: type,
            label: OBSTACLE_META[type].label,
            position_x_m: u,
            position_y_m: v,
            width_m: w,
            length_m: l,
            height_m: h,
            clearance_m: clearance,
          })
        }
      >
        Ajouter sur le pan sélectionné
      </Button>
      {!selectedPlaneId && (
        <p className="text-xs text-muted-foreground">Sélectionnez d'abord un pan.</p>
      )}
      <Separator />
      <ul className="space-y-2">
        {payload.obstacles.map((o) => (
          <li key={o.id} className="flex min-h-11 items-center justify-between gap-2 text-sm">
            <span className="min-w-0 truncate">
              {o.label || OBSTACLE_META[o.obstacle_type as ObstacleType]?.label || o.obstacle_type}{" "}
              · {o.width_m}×{o.length_m} m
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11"
              aria-label="Supprimer"
              disabled={disabled}
              onClick={() => onDelete(o.id)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </li>
        ))}
        {!payload.obstacles.length && (
          <li className="text-xs text-muted-foreground">Aucun obstacle saisi.</li>
        )}
      </ul>
    </Card>
  );
}

function LayoutPanel({
  payload,
  planeId,
  disabled,
  onRun,
  onClear,
}: {
  payload: Payload;
  planeId: string | null;
  disabled: boolean;
  onRun: (values: Record<string, unknown>) => void;
  onClear: () => void;
}) {
  const [moduleId, setModuleId] = useState(payload.catalog[0]?.id ?? "");
  const [orientation, setOrientation] = useState<"portrait" | "paysage">("portrait");
  const [setback, setSetback] = useState(0.4);
  const [rowGap, setRowGap] = useState(0.02);
  const [colGap, setColGap] = useState(0.02);

  const spec = payload.catalog.find((c) => c.id === moduleId);

  return (
    <Card className="space-y-3 p-3">
      <div className="space-y-1.5">
        <Label>Panneau</Label>
        <Select value={moduleId} onValueChange={setModuleId}>
          <SelectTrigger className="min-h-11">
            <SelectValue placeholder="Choisir un panneau" />
          </SelectTrigger>
          <SelectContent>
            {payload.catalog.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.manufacturer} {c.reference} — {c.power_wc} Wc
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {spec && (
          <p className="text-xs text-muted-foreground">
            {(spec.width_mm / 1000).toFixed(3)} × {(spec.height_mm / 1000).toFixed(3)} m ·{" "}
            {spec.technology ?? "—"}
          </p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label>Orientation</Label>
        <Select
          value={orientation}
          onValueChange={(v) => setOrientation(v as "portrait" | "paysage")}
        >
          <SelectTrigger className="min-h-11">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="portrait">Portrait</SelectItem>
            <SelectItem value="paysage">Paysage</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <NumField label="Recul bords (m)" value={setback} step={0.05} onChange={setSetback} />
        <NumField label="Écart rangées (m)" value={rowGap} step={0.01} onChange={setRowGap} />
        <NumField label="Écart colonnes (m)" value={colGap} step={0.01} onChange={setColGap} />
      </div>
      <Button
        className="min-h-11 w-full"
        disabled={disabled || !planeId || !moduleId}
        onClick={() =>
          onRun({
            moduleCatalogId: moduleId,
            orientation,
            setback_m: setback,
            row_gap_m: rowGap,
            col_gap_m: colGap,
          })
        }
      >
        <Sparkles className="mr-2 h-4 w-4" /> Poser sur ce pan
      </Button>
      <Button
        variant="outline"
        className="min-h-11 w-full"
        disabled={disabled || !planeId}
        onClick={onClear}
      >
        <RotateCcw className="mr-2 h-4 w-4" /> Vider ce pan
      </Button>
      <p className="text-xs text-muted-foreground">
        Pose simple sur le pan sélectionné. Pour comparer plusieurs variantes et viser une
        puissance, passez à l'étape Implantation.
      </p>
    </Card>
  );
}

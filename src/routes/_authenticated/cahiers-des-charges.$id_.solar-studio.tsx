import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Boxes, Loader2, Redo2, RotateCcw, Save, Sparkles, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { azimuthLabel } from "@/lib/solar/geo";
import { buildSceneModel } from "@/components/solar/scene-model";
import { PlanView } from "@/components/solar/PlanView";
import { SitePanel } from "@/components/solar/SitePanel";


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
      { property: "og:description", content: "Modélisation 3D du bâtiment et implantation photovoltaïque." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SolarStudioPage,
});

type Payload = NonNullable<SolarModelPayload>;

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
  const snapshot = useServerFn(createSolarVersion);

  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [params, setParams] = useState<BuildingParams>(DEFAULT_BUILDING_PARAMS);
  const [selectedPlaneKey, setSelectedPlaneKey] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // Historique local des paramètres de bâtiment (annuler / rétablir).
  const history = useRef<BuildingParams[]>([]);
  const future = useRef<BuildingParams[]>([]);
  const [historyTick, setHistoryTick] = useState(0);

  const applyPayload = useCallback((next: Payload) => {
    setPayload(next);
    setParams(next.params);
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

  const guard = async (fn: () => Promise<Payload>, success?: string) => {
    if (!canWrite) {
      toast.error("Droits insuffisants.");
      return;
    }
    setBusy(true);
    try {
      const next = await fn();
      applyPayload(next);
      if (success) toast.success(success);
    } catch (e) {
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

  const scene = useMemo(() => (payload ? buildSceneModel(payload) : null), [payload]);
  const selectedPlane = useMemo(
    () => payload?.planes.find((p) => p.key === selectedPlaneKey) ?? null,
    [payload, selectedPlaneKey],
  );

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
            Créez la modélisation 3D du bâtiment. Elle reste rattachée à ce dossier et sera enrichie à chaque étape,
            jusqu'au chantier.
          </p>
          <Button
            className="min-h-11 w-full"
            disabled={!canWrite || busy || !companyId}
            onClick={() =>
              companyId &&
              guard(async () => (await create({ data: { companyId, studyId: id } })) as Payload, "Modélisation créée.")
            }
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            Créer la modélisation
          </Button>
          {!canWrite && <p className="text-xs text-muted-foreground">Votre rôle ne permet pas de créer la modélisation.</p>}
        </Card>
      </div>
    );
  }

  const summary = payload.summary;
  const specForPlane = selectedPlane ? scene?.specByPlaneKey[selectedPlane.key] : undefined;

  return (
    <div className="space-y-4 p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <BackLink id={id} />
          <h1 className="truncate text-lg font-semibold sm:text-xl">{payload.model.name || "Solar Studio"}</h1>
          <p className="truncate text-xs text-muted-foreground">
            {payload.model.address} {payload.model.postal_code} {payload.model.city}
            {payload.model.latitude == null && " — adresse non géolocalisée"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{SOLAR_QUALITY_META[payload.model.quality_level as SolarQualityLevel].label}</Badge>
          <Button variant="outline" size="icon" className="h-11 w-11" aria-label="Annuler" disabled={busy || !history.current.length} onClick={() => void undo()}>
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-11 w-11" aria-label="Rétablir" disabled={busy || !future.current.length} onClick={() => void redo()}>
            <Redo2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-3">
          <Card className="h-[46vh] min-h-[280px] overflow-hidden lg:h-[62vh]">
            <ClientOnly fallback={<Skeleton className="h-full w-full" />}>
              <Suspense fallback={<Skeleton className="h-full w-full" />}>
                {scene && (
                  <SolarScene
                    model={scene}
                    selectedPlaneKey={selectedPlaneKey}
                    onSelectPlane={setSelectedPlaneKey}
                    onToggleModule={(moduleId) => {
                      const current = payload.modules.find((m) => m.id === moduleId);
                      if (!current || !companyId) return;
                      void guard(
                        async () =>
                          (await toggleModule({
                            data: { companyId, modelId: payload.model.id, moduleId, enabled: !current.enabled },
                          })) as Payload,
                      );
                    }}
                  />
                )}
              </Suspense>
            </ClientOnly>
          </Card>

          <Card className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-4">
            <Metric label="Panneaux" value={String(summary.module_count)} />
            <Metric label="Puissance" value={`${summary.power_kwc.toLocaleString("fr-FR")} kWc`} />
            <Metric label="Surface toiture" value={`${summary.roof_area_m2.toLocaleString("fr-FR")} m²`} />
            <Metric
              label="Orientation"
              value={summary.main_azimuth_deg == null ? "—" : `${azimuthLabel(summary.main_azimuth_deg)} · ${summary.main_tilt_deg}°`}
            />
          </Card>

          <Card className="h-[34vh] min-h-[220px] overflow-hidden p-2">
            <PlanView
              plane={selectedPlane ?? null}
              modules={payload.modules}
              obstacles={scene?.obstacles ?? []}
              spec={specForPlane}
              onToggleModule={(moduleId) => {
                const current = payload.modules.find((m) => m.id === moduleId);
                if (!current || !companyId) return;
                void guard(
                  async () =>
                    (await toggleModule({
                      data: { companyId, modelId: payload.model.id, moduleId, enabled: !current.enabled },
                    })) as Payload,
                );
              }}
            />
          </Card>
        </div>

        <Tabs defaultValue="batiment" className="min-w-0">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="batiment">Bâtiment</TabsTrigger>
            <TabsTrigger value="site">Site</TabsTrigger>
            <TabsTrigger value="pans">Pans</TabsTrigger>
            <TabsTrigger value="obstacles">Obstacles</TabsTrigger>
            <TabsTrigger value="pose">Pose</TabsTrigger>
          </TabsList>

          <TabsContent value="site">
            <SitePanel payload={payload} companyId={companyId} disabled={!canWrite || busy} onPayload={applyPayload} />
          </TabsContent>


          <TabsContent value="batiment">
            <Card className="space-y-3 p-3">
              <div className="space-y-1.5">
                <Label>Type de toiture</Label>
                <Select value={params.roof_type} onValueChange={(v) => patchParams({ roof_type: v as RoofType })}>
                  <SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(ROOF_TYPE_META) as RoofType[]).map((t) => (
                      <SelectItem key={t} value={t}>{ROOF_TYPE_META[t].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <NumField label="Largeur (m)" value={params.width_m} step={0.1} onChange={(v) => patchParams({ width_m: v })} />
                <NumField label="Profondeur (m)" value={params.depth_m} step={0.1} onChange={(v) => patchParams({ depth_m: v })} />
                <NumField label="Hauteur mur (m)" value={params.wall_height_m} step={0.1} onChange={(v) => patchParams({ wall_height_m: v })} />
                <NumField label="Pente (°)" value={params.tilt_deg} step={1} onChange={(v) => patchParams({ tilt_deg: v })} />
                <NumField label="Azimut (°)" value={params.azimuth_deg} step={5} onChange={(v) => patchParams({ azimuth_deg: v })} />
                <NumField label="Débord (m)" value={params.overhang_m} step={0.05} onChange={(v) => patchParams({ overhang_m: v })} />
              </div>
              <p className="text-xs text-muted-foreground">
                Azimut {Math.round(params.azimuth_deg)}° — pan principal orienté {azimuthLabel(params.azimuth_deg)}.
              </p>
              <Button className="min-h-11 w-full" disabled={!canWrite || busy || !dirty} onClick={() => void persistParams(params)}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Enregistrer le bâtiment
              </Button>
              <Separator />
              <div className="space-y-1.5">
                <Label>Niveau de fiabilité du modèle</Label>
                <Select
                  value={payload.model.quality_level}
                  onValueChange={(v) =>
                    companyId &&
                    void guard(
                      async () =>
                        (await saveMeta({
                          data: { companyId, modelId: payload.model.id, quality_level: v as SolarQualityLevel },
                        })) as Payload,
                      "Niveau mis à jour.",
                    )
                  }
                >
                  <SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(SOLAR_QUALITY_META) as SolarQualityLevel[]).map((q) => (
                      <SelectItem key={q} value={q}>{SOLAR_QUALITY_META[q].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {SOLAR_QUALITY_META[payload.model.quality_level as SolarQualityLevel].help}
                </p>
              </div>
              <Button
                variant="outline"
                className="min-h-11 w-full"
                disabled={!canWrite || busy || !companyId}
                onClick={() =>
                  companyId &&
                  void guard(
                    async () => (await snapshot({ data: { companyId, modelId: payload.model.id, label: "" } })) as Payload,
                    "Version enregistrée.",
                  )
                }
              >
                Figer une version ({payload.versions.length})
              </Button>
              <p className="text-xs text-muted-foreground">
                Modèle géométrique déclaratif : les dimensions restent à confirmer lors de la visite technique.
              </p>
            </Card>
          </TabsContent>

          <TabsContent value="pans">
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
                      {azimuthLabel(plane.azimuth_deg)} · {Math.round(plane.tilt_deg)}° · {plane.area_m2.toFixed(1)} m²
                    </span>
                  </span>
                  <Badge variant="outline">
                    {payload.modules.filter((m) => m.roof_plane_key === plane.key && m.enabled).length}
                  </Badge>
                </button>
              ))}
            </Card>
          </TabsContent>

          <TabsContent value="obstacles">
            <ObstaclePanel
              payload={payload}
              selectedPlaneId={selectedPlane?.id ?? null}
              disabled={!canWrite || busy || !companyId}
              onAdd={(values) =>
                companyId &&
                void guard(
                  async () =>
                    (await saveObstacle({
                      data: { companyId, modelId: payload.model.id, ...values },
                    })) as Payload,
                  "Obstacle ajouté.",
                )
              }
              onDelete={(obstacleId) =>
                companyId &&
                void guard(
                  async () =>
                    (await removeObstacle({ data: { companyId, modelId: payload.model.id, obstacleId } })) as Payload,
                  "Obstacle supprimé.",
                )
              }
            />
          </TabsContent>

          <TabsContent value="pose">
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
                      data: { companyId, modelId: payload.model.id, roofPlaneId: selectedPlane.id, ...values },
                    })) as Payload,
                  "Implantation calculée.",
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
                  "Implantation supprimée.",
                )
              }
            />
          </TabsContent>
        </Tabs>
      </div>
      <p className="sr-only">{historyTick}</p>
    </div>
  );
}

function BackLink({ id }: { id: string }) {
  return (
    <Link
      to="/cahiers-des-charges/$id"
      params={{ id }}
      className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
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
          <SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(OBSTACLE_META) as ObstacleType[]).map((t) => (
              <SelectItem key={t} value={t}>{OBSTACLE_META[t].label}</SelectItem>
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
        <NumField label="Marge de sécurité (m)" value={clearance} step={0.05} onChange={setClearance} />
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
      {!selectedPlaneId && <p className="text-xs text-muted-foreground">Sélectionnez d'abord un pan.</p>}
      <Separator />
      <ul className="space-y-2">
        {payload.obstacles.map((o) => (
          <li key={o.id} className="flex min-h-11 items-center justify-between gap-2 text-sm">
            <span className="min-w-0 truncate">
              {o.label || OBSTACLE_META[o.obstacle_type as ObstacleType]?.label || o.obstacle_type} · {o.width_m}×{o.length_m} m
            </span>
            <Button variant="ghost" size="icon" className="h-11 w-11" aria-label="Supprimer" disabled={disabled} onClick={() => onDelete(o.id)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </li>
        ))}
        {!payload.obstacles.length && <li className="text-xs text-muted-foreground">Aucun obstacle saisi.</li>}
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
          <SelectTrigger className="min-h-11"><SelectValue placeholder="Choisir un panneau" /></SelectTrigger>
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
            {(spec.width_mm / 1000).toFixed(3)} × {(spec.height_mm / 1000).toFixed(3)} m · {spec.technology ?? "—"}
          </p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label>Orientation</Label>
        <Select value={orientation} onValueChange={(v) => setOrientation(v as "portrait" | "paysage")}>
          <SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
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
        onClick={() => onRun({ moduleCatalogId: moduleId, orientation, setback_m: setback, row_gap_m: rowGap, col_gap_m: colGap })}
      >
        <Sparkles className="mr-2 h-4 w-4" /> Calculer l'implantation
      </Button>
      <Button variant="outline" className="min-h-11 w-full" disabled={disabled || !planeId} onClick={onClear}>
        <RotateCcw className="mr-2 h-4 w-4" /> Vider ce pan
      </Button>
      <p className="text-xs text-muted-foreground">
        Le calcul évite les obstacles du pan et respecte les reculs saisis. Cliquez un panneau (3D ou plan) pour le
        désactiver sans le supprimer.
      </p>
    </Card>
  );
}

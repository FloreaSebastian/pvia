/**
 * Solar Studio — expérience carte : adresse, confirmation du bâtiment,
 * superposition du modèle PVIA, mesures et vue comparée.
 *
 * Séparation stricte : Google fournit le VISUEL, PVIA fournit la MESURE.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Crosshair, Ruler, Search, SplitSquareHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { GoogleMapView, type MapMeasureResult } from "./GoogleMapView";
import { PlanView } from "@/components/solar/PlanView";
import { buildSceneModel } from "@/components/solar/scene-model";
import {
  searchMapPlaces,
  checkStreetViewCoverage,
  getMapsBrowserKey,
  type MapPlaceCandidate,
} from "@/lib/solar-maps.functions";
import { confirmSolarLocation, saveSolarMeasurement } from "@/lib/solar-geo.functions";
import { buildOverlayFeatures, type MapMeasureKind } from "@/lib/solar/map/overlay-model";
import {
  GOOGLE_MAPS_PROVIDER,
  MAP_LAYER_LABEL,
  MAP_USAGE_LABEL,
  countMapUsage,
  readMapUsage,
  readMapsDiagnostics,
  setRuntimeMapsKey,
  type MapBaseLayer,
  type MapUsage,
} from "@/lib/solar/map/provider";
import { planePointToWorld } from "@/lib/solar/roof";
import type { LatLon } from "@/lib/solar/geo";
import type { SolarModelPayload } from "@/lib/solar.functions";

type Payload = NonNullable<SolarModelPayload>;

interface Props {
  payload: Payload;
  companyId: string;
  disabled: boolean;
  selectedPlaneKey: string | null;
  onSelectPlane: (key: string | null) => void;
  onPayload: (next: Payload) => void;
}

const LAYERS: MapBaseLayer[] = ["plan", "satellite", "hybrid", "tilted"];


export function SiteMapCard({ payload, companyId, disabled, selectedPlaneKey, onSelectPlane, onPayload }: Props) {
  const searchFn = useServerFn(searchMapPlaces);
  const streetViewFn = useServerFn(checkStreetViewCoverage);
  const confirmFn = useServerFn(confirmSolarLocation);
  const measureFn = useServerFn(saveSolarMeasurement);

  const model = payload.model;
  const located = model.origin_latitude != null && model.origin_longitude != null;

  const [query, setQuery] = useState(model.address ?? "");
  const [candidates, setCandidates] = useState<MapPlaceCandidate[]>([]);
  const [pending, setPending] = useState<LatLon | null>(null);
  const [layer, setLayer] = useState<MapBaseLayer>("satellite");
  const [opacity, setOpacity] = useState(80);
  const [swipe, setSwipe] = useState(100);
  const [outline, setOutline] = useState(false);
  const [split, setSplit] = useState(false);
  const [measure, setMeasure] = useState<MapMeasureKind | null>(null);
  const [lastMeasure, setLastMeasure] = useState<MapMeasureResult | null>(null);
  const [streetView, setStreetView] = useState<{ available: boolean; detail: string } | null>(null);
  const [usage, setUsage] = useState<MapUsage>(() => readMapUsage());
  const [busy, setBusy] = useState(false);
  const keyFn = useServerFn(getMapsBrowserKey);
  // La clé navigateur est servie par le serveur : on attend sa réception avant
  // de conclure que la cartographie n'est pas configurée.
  const [keyState, setKeyState] = useState<"loading" | "ready">("loading");

  useEffect(() => {
    let cancelled = false;
    keyFn()
      .then((res) => {
        if (cancelled) return;
        setRuntimeMapsKey(res.key);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setKeyState("ready");
      });
    return () => {
      cancelled = true;
    };
  }, [keyFn]);

  const mapConfigured = keyState === "ready" && GOOGLE_MAPS_PROVIDER.isConfigured();
  const diagnostics = readMapsDiagnostics(true);


  const origin: LatLon | null = pending
    ? pending
    : located
      ? { latitude: model.origin_latitude!, longitude: model.origin_longitude! }
      : null;

  const scene = useMemo(() => buildSceneModel(payload), [payload]);

  const features = useMemo(() => {
    const planeByKey = new Map(scene.planes.map((p) => [p.key, p]));
    const obstacles = scene.obstacles.map((o) => {
      const plane = o.planeKey ? planeByKey.get(o.planeKey) : null;
      const world = plane ? planePointToWorld(plane.frame, o.u, o.v) : [o.u, o.v, o.baseZ];
      return {
        id: o.id,
        label: "Obstacle",
        type: "obstacle",
        x: world[0]!,
        y: world[1]!,
        w: o.width,
        l: o.length,
        rotation: 0,
        source: "Saisie PVIA / relevé",
      };
    });
    const specs: Record<string, { width_m: number; height_m: number; power_wc: number | null } | undefined> = {};
    for (const [key, spec] of Object.entries(scene.specByPlaneKey)) {
      if (!spec) continue;
      specs[key] = { width_m: spec.width_mm / 1000, height_m: spec.height_mm / 1000, power_wc: null };
    }
    const planeSource: Record<string, string> = {};
    for (const p of payload.planes) {
      planeSource[p.key] = sourceLabel((p as { data_source?: string }).data_source ?? "manuel");
    }
    return buildOverlayFeatures({
      planes: scene.planes,
      obstacles,
      modules: scene.modules,
      specByPlaneKey: specs,
      planeSource,
    });
  }, [scene, payload.planes]);

  const selected = features.find((f) => f.kind === "plane" && f.planeKey === selectedPlaneKey) ?? null;

  useEffect(() => {
    if (!origin) return;
    let cancelled = false;
    streetViewFn({ data: { companyId, latitude: origin.latitude, longitude: origin.longitude } })
      .then((res) => !cancelled && setStreetView(res))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [companyId, origin?.latitude, origin?.longitude, streetViewFn]);

  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action impossible.");
    } finally {
      setBusy(false);
    }
  }, []);

  const nextAction = !origin
    ? "Localiser le bâtiment"
    : pending
      ? "Confirmer le site"
      : payload.planes.length === 0
        ? "Créer la toiture"
        : payload.modules.length === 0
          ? "Ajouter les panneaux"
          : "Analyser";

  return (
    <Card className="space-y-3 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Vue du site</h2>
        <Badge variant="outline">Prochaine étape : {nextAction}</Badge>
      </div>

      {/* ------------------------------ Recherche ------------------------------- */}
      <div className="flex gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher une adresse…"
          className="min-h-11"
          aria-label="Rechercher une adresse"
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            void run(async () => {
              const res = await searchFn({ data: { companyId, query } });
              setUsage(countMapUsage("place_search"));
              if (res.error) toast.error(res.error);
              setCandidates(res.candidates);
              if (!res.candidates.length && !res.error) toast.info("Aucune adresse trouvée.");
            });
          }}
        />
        <Button
          variant="outline"
          className="min-h-11"
          disabled={busy || query.trim().length < 3}
          onClick={() =>
            void run(async () => {
              const res = await searchFn({ data: { companyId, query } });
              setUsage(countMapUsage("place_search"));
              if (res.error) toast.error(res.error);
              setCandidates(res.candidates);
              if (!res.candidates.length && !res.error) toast.info("Aucune adresse trouvée.");
            })
          }
        >
          <Search className="mr-2 h-4 w-4" aria-hidden />
          Rechercher
        </Button>
      </div>

      {candidates.length > 0 && (
        <ul className="space-y-1">
          {candidates.map((c) => (
            <li key={c.place_id}>
              <button
                type="button"
                className="min-h-11 w-full rounded-md border px-2 py-1.5 text-left text-xs hover:bg-accent"
                onClick={() => {
                  setPending({ latitude: c.latitude, longitude: c.longitude });
                  setQuery(c.address || c.label);
                  setCandidates([]);
                }}
              >
                <span className="block font-medium">{c.label}</span>
                <span className="block text-muted-foreground">{c.address}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {candidates.length > 1 && (
        <p className="text-xs text-muted-foreground">
          Plusieurs adresses correspondent : choisissez celle du chantier, rien n'est retenu automatiquement.
        </p>
      )}

      {/* -------------------------------- Carte --------------------------------- */}
      {origin ? (
        <>
          <div className="flex flex-wrap gap-1.5">
            {LAYERS.map((l) => (
              <Button
                key={l}
                size="sm"
                variant={layer === l ? "default" : "outline"}
                className="min-h-11"
                onClick={() => {
                  setLayer(l);
                  if (l === "tilted") setUsage(countMapUsage("tilted"));
                }}

              >
                {MAP_LAYER_LABEL[l]}
              </Button>
            ))}
            <Button
              size="sm"
              variant={split ? "default" : "outline"}
              className="min-h-11"
              onClick={() => setSplit((v) => !v)}
            >
              <SplitSquareHorizontal className="mr-2 h-4 w-4" aria-hidden />
              Vue double
            </Button>
            <Button
              size="sm"
              variant={measure ? "default" : "outline"}
              className="min-h-11"
              onClick={() => setMeasure((m) => (m ? null : "distance"))}
            >
              <Ruler className="mr-2 h-4 w-4" aria-hidden />
              Mesurer
            </Button>
          </div>

          {measure && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {(["distance", "area"] as MapMeasureKind[]).map((k) => (
                <Button
                  key={k}
                  size="sm"
                  variant={measure === k ? "secondary" : "outline"}
                  className="min-h-11"
                  onClick={() => setMeasure(k)}
                >
                  {k === "distance" ? "Distance" : "Surface"}
                </Button>
              ))}
              <span className="text-muted-foreground">
                Cliquez sur la géométrie PVIA : le curseur s'accroche aux coins, rives et faîtages. Double-clic pour
                recommencer.
              </span>
            </div>
          )}

          <div className={split ? "grid gap-2 lg:grid-cols-2" : ""}>
            <div className="h-[46vh] min-h-[260px]">
              {keyState === "loading" ? (
                <div className="flex h-full items-center justify-center rounded-md border bg-muted/30 text-sm text-muted-foreground">
                  Préparation de la carte…
                </div>
              ) : (
              <GoogleMapView
                origin={origin}
                layer={layer}
                features={features}
                modelOpacity={opacity / 100}
                outlineOnly={outline}
                swipePercent={swipe}
                measure={measure}
                selectedPlaneKey={selectedPlaneKey}
                pickMode={!!pending}
                onPickLocation={(p) => setPending(p)}
                onSelectPlane={onSelectPlane}
                onMeasured={(r) => setLastMeasure(r)}
              />
            </div>
            {split && (
              <div className="h-[46vh] min-h-[260px] overflow-hidden rounded-md border p-2">
                <PlanView
                  plane={scene.planes.find((p) => p.key === selectedPlaneKey) ?? scene.planes[0] ?? null}
                  modules={scene.modules}
                  obstacles={scene.obstacles}
                  spec={scene.specByPlaneKey[selectedPlaneKey ?? scene.planes[0]?.key ?? ""]}
                  onToggleModule={() => undefined}
                />
              </div>
            )}
          </div>

          <p className="text-[11px] text-muted-foreground">{GOOGLE_MAPS_PROVIDER.attribution}</p>
          <p className="text-[11px] text-muted-foreground">{GOOGLE_MAPS_PROVIDER.derivativeRestriction}</p>

          {pending && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border p-2">
              <Crosshair className="h-4 w-4 text-primary" aria-hidden />
              <span className="text-xs">
                Déplacez le repère sur le bâtiment, puis confirmez : {pending.latitude.toFixed(6)},{" "}
                {pending.longitude.toFixed(6)}
              </span>
              <Button
                className="min-h-11"
                disabled={disabled || busy}
                onClick={() =>
                  void run(async () => {
                    const next = (await confirmFn({
                      data: {
                        companyId,
                        modelId: model.id,
                        latitude: pending.latitude,
                        longitude: pending.longitude,
                        address: query.slice(0, 200),
                      },
                    })) as Payload;
                    onPayload(next);
                    setPending(null);
                    toast.success("Site confirmé.");
                  })
                }
              >
                Confirmer le site
              </Button>
              <Button variant="ghost" className="min-h-11" onClick={() => setPending(null)}>
                Annuler
              </Button>
            </div>
          )}

          {/* ----------------------------- Réglages vue --------------------------- */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Modèle PVIA — opacité {opacity} %</Label>
              <Slider value={[opacity]} min={0} max={100} step={5} onValueChange={([v]) => setOpacity(v ?? 80)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Balayage Google ← → Modèle</Label>
              <Slider value={[swipe]} min={0} max={100} step={1} onValueChange={([v]) => setSwipe(v ?? 100)} />
            </div>
            <div className="flex items-center gap-2">
              <Switch id="outline" checked={outline} onCheckedChange={setOutline} />
              <Label htmlFor="outline" className="text-xs">
                Mode contour (arêtes seules)
              </Label>
            </div>
            <p className="text-xs text-muted-foreground">
              {streetView ? streetView.detail : "Vérification de la vue de rue…"}
            </p>
          </div>

          {/* ------------------------------ Sélection ----------------------------- */}
          {selected && (
            <div className="rounded-md border p-2 text-xs">
              <p className="font-medium">{selected.label}</p>
              {selected.detail.map((d) => (
                <p key={d} className="text-muted-foreground">
                  {d}
                </p>
              ))}
              <p className="text-muted-foreground">Source : {selected.source}</p>
              <p className="text-muted-foreground">Fond affiché : Google {MAP_LAYER_LABEL[layer]} (visuel seulement)</p>
            </div>
          )}

          {lastMeasure && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-xs">
              <span className="font-medium">{lastMeasure.text}</span>
              <span className="text-muted-foreground">mesuré sur la géométrie PVIA</span>
              <Button
                size="sm"
                className="min-h-11"
                disabled={disabled || busy}
                onClick={() =>
                  void run(async () => {
                    await measureFn({
                      data: {
                        companyId,
                        modelId: model.id,
                        measure_type: lastMeasure.kind === "area" ? "area" : "distance",
                        category: "autre",
                        label: lastMeasure.kind === "area" ? "Surface relevée sur plan" : "Distance relevée sur plan",
                        value_numeric: lastMeasure.value,
                        unit: lastMeasure.unit === "m²" ? "m2" : "m",
                        pinned: true,
                        geometry: lastMeasure.points.map((p) => [p.x, p.y, 0] as [number, number, number]),
                        data_source: "MANUAL",
                      },
                    });
                    toast.success("Cote enregistrée dans le modèle.");
                    setLastMeasure(null);
                  })
                }
              >
                Enregistrer la cote
              </Button>
            </div>
          )}

          <p className="text-[11px] text-muted-foreground">
            Appels cartographiques aujourd'hui —{" "}
            {(Object.keys(usage.counts) as (keyof typeof usage.counts)[])
              .map((k) => `${MAP_USAGE_LABEL[k]} ${usage.counts[k]}`)
              .join(" · ")}
          </p>

          <details className="rounded-md border p-2 text-[11px] text-muted-foreground">
            <summary className="min-h-11 cursor-pointer text-xs font-medium text-foreground">
              Diagnostic cartographie
            </summary>
            <ul className="mt-1 space-y-0.5">
              <li>Clé cartographique : {diagnostics.keyPresent ? diagnostics.keyMasked : "non configurée"}</li>
              <li>
                Origine de la clé :{" "}
                {diagnostics.keySource === "pvia"
                  ? "clé PVIA dédiée"
                  : diagnostics.keySource === "lovable_connector"
                    ? "connexion gérée (domaines *.lovable.app uniquement)"
                    : "aucune"}
              </li>
              <li>
                Domaine actuel : {diagnostics.host || "inconnu"} —{" "}
                {diagnostics.hostAllowedByKey ? "compatible avec la clé" : "non couvert par cette clé"}
              </li>
              <li>API cartographique chargée : {diagnostics.apiLoaded ? "oui" : "non"}</li>
              <li>Style personnalisé : {diagnostics.mapId ? "configuré" : "aucun"}</li>
              <li>3D photoréaliste : non utilisée (la vue inclinée est une vue satellite inclinée)</li>
              <li>Dernière erreur : {diagnostics.lastError ? diagnostics.lastError.message : "aucune"}</li>
            </ul>
          </details>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          Recherchez l'adresse du chantier pour afficher la carte et positionner le bâtiment.
        </p>
      )}

      {!mapConfigured && (
        <p className="rounded-md border p-2 text-xs text-muted-foreground">
          Fond cartographique non configuré pour ce domaine : la recherche d'adresse et le modèle technique PVIA
          restent utilisables, seule l'imagerie Google est indisponible.
        </p>
      )}

    </Card>
  );
}

function sourceLabel(source: string): string {
  switch (source) {
    case "lidar":
      return "LiDAR / IGN";
    case "satellite":
      return "Contour cartographique autorisé";
    case "mesure_manuelle":
      return "Mesure utilisateur";
    case "visite_technique":
      return "Visite terrain";
    case "drone":
      return "Relevé drone";
    case "import":
      return "Import utilisateur";
    default:
      return "Géométrie paramétrique PVIA";
  }
}

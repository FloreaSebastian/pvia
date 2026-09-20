/// <reference types="google.maps" />
/**
 * Solar Studio — vue cartographique Google avec superposition du modèle PVIA.
 *
 * Le fond Google est une image de repérage. Tout ce qui est dessiné au-dessus
 * (pans, faîtages, obstacles, panneaux, cotes) appartient au modèle PVIA et
 * est calculé par son propre moteur géométrique.
 *
 * P0-B : le canevas devient aussi l'outil de dessin de la toiture (tracé de pan,
 * sommets déplaçables, insertion/suppression de sommet, obstacle rectangulaire).
 * Aucune géométrie n'est enregistrée sans validation — le parent décide.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  distance,
  polygonArea,
  toLatLon,
  toLocal,
  type LatLon,
  type LocalPoint,
} from "@/lib/solar/geo";
import {
  buildSnapModel,
  measureOnModel,
  snapToModel,
  type MapMeasureKind,
  type OverlayFeature,
} from "@/lib/solar/map/overlay-model";
import { nearestEdge, snapDrawPoint, validateRoofRing } from "@/lib/solar/polygon";
import {
  browserMapsKey,
  countMapUsage,
  describeMapsError,
  mapsMapId,
  mapsTrackingId,
  markMapsLoaded,
  recordMapsError,
  type MapBaseLayer,
  type MapsErrorInfo,
} from "@/lib/solar/map/provider";

let loaderPromise: Promise<typeof google.maps> | null = null;

/** Charge l'API Maps une seule fois par session : aucun rechargement facturé inutilement. */
export function loadGoogleMaps(): Promise<typeof google.maps> {
  if (loaderPromise) return loaderPromise;
  const key = browserMapsKey();
  if (!key) return Promise.reject(new Error("NOT_CONFIGURED"));
  loaderPromise = new Promise((resolve, reject) => {
    const w = window as unknown as { __pviaMapsReady?: () => void; gm_authFailure?: () => void };
    w.__pviaMapsReady = () => {
      markMapsLoaded();
      resolve(google.maps);
    };
    // Google signale les refus de clé/domaine par ce callback global.
    w.gm_authFailure = () => {
      recordMapsError("RefererNotAllowedMapError");
      reject(new Error("RefererNotAllowedMapError"));
    };
    const script = document.createElement("script");
    const channel = mapsTrackingId();
    // auth_referrer_policy=origin : Google ne reçoit que l'origine (https://pvia.fr),
    // jamais le chemin. La restriction de clé se fait donc au domaine, sans motif de chemin.
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&loading=async&libraries=geometry&auth_referrer_policy=origin&callback=__pviaMapsReady${
      channel ? `&channel=${encodeURIComponent(channel)}` : ""
    }`;
    script.async = true;
    script.onerror = () => {
      recordMapsError("SCRIPT_LOAD_FAILED");
      reject(new Error("SCRIPT_LOAD_FAILED"));
    };
    document.head.appendChild(script);
    countMapUsage("map_load");
  });
  return loaderPromise;
}

const MAP_TYPE: Record<Exclude<MapBaseLayer, "tilted" | "street_view">, string> = {
  plan: "roadmap",
  satellite: "satellite",
  hybrid: "hybrid",
};

const STYLE: Record<OverlayFeature["kind"], { stroke: string; fill: string; width: number }> = {
  plane: { stroke: "#38bdf8", fill: "rgba(56,189,248,0.28)", width: 2 },
  ridge: { stroke: "#f8fafc", fill: "transparent", width: 3 },
  obstacle: { stroke: "#f97316", fill: "rgba(249,115,22,0.35)", width: 1.5 },
  module: { stroke: "#0f172a", fill: "rgba(15,23,42,0.75)", width: 1 },
  forbidden: { stroke: "#ef4444", fill: "rgba(239,68,68,0.25)", width: 1.5 },
};

export interface MapMeasureResult {
  kind: MapMeasureKind;
  text: string;
  value: number;
  unit: "m" | "m²";
  points: LocalPoint[];
}

/** Outil actif de l'étape Toiture. */
export type RoofDrawTool = "select" | "draw_plane" | "add_obstacle";

/** Contour éditable transmis par le parent (pan dessiné). */
export interface EditableRing {
  key: string;
  name: string;
  ring: LocalPoint[];
}

interface Props {
  origin: LatLon;
  layer: MapBaseLayer;
  features: OverlayFeature[];
  /** 0 = fond seul, 1 = modèle pleinement opaque. */
  modelOpacity: number;
  outlineOnly: boolean;
  /** Balayage GOOGLE ← → MODÈLE, en pourcentage de largeur. */
  swipePercent: number;
  measure: MapMeasureKind | null;
  selectedPlaneKey: string | null;
  pickMode?: boolean;
  /** Outil de dessin toiture. Absent = carte en consultation (comportement historique). */
  drawTool?: RoofDrawTool | null;
  editableRings?: EditableRing[];
  snapEnabled?: boolean;
  onPickLocation?: (point: LatLon) => void;
  onSelectPlane?: (planeKey: string | null) => void;
  onMeasured?: (result: MapMeasureResult) => void;
  onCameraChange?: (view: { center: LatLon; zoom: number }) => void;
  /** Nouveau pan terminé (contour au sol, déjà validé localement). */
  onPlaneDrawn?: (ring: LocalPoint[]) => void;
  /** Contour modifié — appelé à la FIN du geste, jamais à chaque pixel. */
  onRingChange?: (key: string, ring: LocalPoint[]) => void;
  /** Emprise rectangulaire d'un obstacle tracée sur la carte. */
  onObstacleDrawn?: (ring: LocalPoint[]) => void;
  /** Message d'aide géométrique en direct (tracé invalide, etc.). */
  onDrawIssue?: (message: string | null) => void;
  /** Incrémenter cette valeur recentre la carte sur le site. */
  recenterSignal?: number;
}

const HANDLE_TOLERANCE_M = 0.7;

export function GoogleMapView({
  origin,
  layer,
  features,
  modelOpacity,
  outlineOnly,
  swipePercent,
  measure,
  selectedPlaneKey,
  pickMode = false,
  drawTool = null,
  editableRings,
  snapEnabled = true,
  onPickLocation,
  onSelectPlane,
  onMeasured,
  onCameraChange,
  onPlaneDrawn,
  onRingChange,
  onObstacleDrawn,
  onDrawIssue,
  recenterSignal = 0,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  // Google injecte ses propres nœuds DOM : il lui faut un conteneur dédié que
  // React ne gère jamais, sinon React tente de retirer des nœuds déplacés.
  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const overlayRef = useRef<google.maps.OverlayView | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const [error, setError] = useState<MapsErrorInfo | null>(null);
  const [ready, setReady] = useState(false);
  const [points, setPoints] = useState<LocalPoint[]>([]);
  const [hover, setHover] = useState<{ point: LocalPoint; label: string | null } | null>(null);
  const [draft, setDraft] = useState<LocalPoint[]>([]);
  const [drag, setDrag] = useState<{ key: string; index: number; ring: LocalPoint[] } | null>(null);
  const [rect, setRect] = useState<{ start: LocalPoint; current: LocalPoint } | null>(null);

  const selectRef = useRef(onSelectPlane);
  selectRef.current = onSelectPlane;

  const rings = useMemo(() => editableRings ?? [], [editableRings]);
  const snapModel = useMemo(() => buildSnapModel(features), [features]);
  const state = useRef({
    features,
    modelOpacity,
    outlineOnly,
    swipePercent,
    points,
    hover,
    selectedPlaneKey,
    origin,
    draft,
    drag,
    rect,
    rings,
    drawTool,
  });
  state.current = {
    features,
    modelOpacity,
    outlineOnly,
    swipePercent,
    points,
    hover,
    selectedPlaneKey,
    origin,
    draft,
    drag,
    rect,
    rings,
    drawTool,
  };

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    const overlay = overlayRef.current;
    const projection = overlay?.getProjection();
    if (!canvas || !host || !projection) return;

    const dpr = window.devicePixelRatio || 1;
    const w = host.clientWidth;
    const h = host.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const s = state.current;
    const toPixel = (p: LocalPoint) => {
      const ll = toLatLon(s.origin, p);
      const px = projection.fromLatLngToContainerPixel(
        new google.maps.LatLng(ll.latitude, ll.longitude),
      );
      return px ? { x: px.x, y: px.y } : null;
    };

    ctx.save();
    // Balayage : le modèle n'est dessiné que sur la portion choisie.
    ctx.beginPath();
    ctx.rect(0, 0, (w * s.swipePercent) / 100, h);
    ctx.clip();
    ctx.globalAlpha = Math.max(0.05, s.modelOpacity);

    for (const f of s.features) {
      const style = STYLE[f.kind];
      const pts = f.ring.map(toPixel);
      if (pts.some((p) => !p) || pts.length < 2) continue;
      ctx.beginPath();
      pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p!.x, p!.y) : ctx.lineTo(p!.x, p!.y)));
      if (f.closed) ctx.closePath();
      if (f.closed && !s.outlineOnly) {
        ctx.fillStyle = style.fill;
        ctx.fill();
      }
      ctx.lineWidth =
        f.planeKey && f.planeKey === s.selectedPlaneKey ? style.width + 2 : style.width;
      ctx.strokeStyle = f.planeKey && f.planeKey === s.selectedPlaneKey ? "#facc15" : style.stroke;
      ctx.stroke();
    }
    ctx.restore();

    /** Cote lisible : fond sombre + texte clair, quelle que soit l'imagerie. */
    const label = (text: string, x: number, y: number) => {
      ctx.font = "600 11px system-ui, sans-serif";
      const pad = 3;
      const width = ctx.measureText(text).width;
      ctx.fillStyle = "rgba(15,23,42,0.82)";
      ctx.fillRect(x - width / 2 - pad, y - 8 - pad, width + pad * 2, 14 + pad);
      ctx.fillStyle = "#f8fafc";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, x, y);
    };

    /** Contour de travail : segments, cotes en mètres, surface, sommets saisissables. */
    const drawWorkingRing = (
      ring: LocalPoint[],
      closed: boolean,
      color: string,
      handles: boolean,
    ) => {
      const pts = ring.map(toPixel);
      if (pts.some((p) => !p) || pts.length < 1) return;
      const px = pts as { x: number; y: number }[];
      if (px.length >= 2) {
        ctx.beginPath();
        px.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        if (closed) ctx.closePath();
        if (closed) {
          ctx.fillStyle = "rgba(250,204,21,0.18)";
          ctx.fill();
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      const limit = closed ? ring.length : ring.length - 1;
      for (let i = 0; i < limit; i += 1) {
        const a = px[i]!;
        const b = px[(i + 1) % px.length]!;
        const d = distance(ring[i]!, ring[(i + 1) % ring.length]!);
        if (d >= 0.2) label(`${d.toFixed(2)} m`, (a.x + b.x) / 2, (a.y + b.y) / 2);
      }
      if (closed && ring.length >= 3) {
        const cx = px.reduce((s2, p) => s2 + p.x, 0) / px.length;
        const cy = px.reduce((s2, p) => s2 + p.y, 0) / px.length;
        label(`${polygonArea(ring).toFixed(1)} m²`, cx, cy);
      }
      if (handles) {
        for (const p of px) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
          ctx.fillStyle = "#facc15";
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = "#0f172a";
          ctx.stroke();
        }
      }
    };

    // Pans dessinés : sommets saisissables sur le pan sélectionné.
    if (s.drawTool) {
      for (const r of s.rings) {
        const live = s.drag && s.drag.key === r.key ? s.drag.ring : r.ring;
        const selected = r.key === s.selectedPlaneKey;
        drawWorkingRing(live, true, selected ? "#facc15" : "#38bdf8", selected);
      }
    }

    // Tracé en cours : ligne provisoire vers le pointeur.
    if (s.draft.length) {
      const live = s.hover ? [...s.draft, s.hover.point] : s.draft;
      drawWorkingRing(live, false, "#22c55e", true);
    }

    // Emprise d'obstacle en cours de glissement.
    if (s.rect) {
      const r = rectRing(s.rect.start, s.rect.current);
      drawWorkingRing(r, true, "#f97316", false);
    }

    // Mesure en cours : cotes dessinées par le moteur PVIA.
    if (s.points.length) {
      const pts = s.points.map(toPixel).filter(Boolean) as { x: number; y: number }[];
      const live = s.hover ? toPixel(s.hover.point) : null;
      const all = live ? [...pts, live] : pts;
      ctx.save();
      ctx.strokeStyle = "#facc15";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      all.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();
      ctx.setLineDash([]);
      all.forEach((p) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = "#facc15";
        ctx.fill();
      });
      ctx.restore();
    }

    if (s.hover) {
      const p = toPixel(s.hover.point);
      if (p) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
        ctx.strokeStyle = "#facc15";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then((maps) => {
        if (cancelled || !mapDivRef.current) return;
        const mapId = mapsMapId();
        const map = new maps.Map(mapDivRef.current, {
          center: { lat: origin.latitude, lng: origin.longitude },
          zoom: 20,
          mapTypeId: MAP_TYPE.satellite,
          tilt: 0,
          streetViewControl: false,
          fullscreenControl: false,
          mapTypeControl: false,
          gestureHandling: "greedy",
          ...(mapId ? { mapId } : {}),
        });

        mapRef.current = map;

        const overlay = new maps.OverlayView();
        overlay.onAdd = () => undefined;
        overlay.onRemove = () => undefined;
        overlay.draw = () => draw();
        overlay.setMap(map);
        overlayRef.current = overlay;

        map.addListener("bounds_changed", draw);
        map.addListener("click", (ev: google.maps.MapMouseEvent) => {
          const handler = selectRef.current;
          if (!handler || !ev.latLng) return;
          const p = toLocal(state.current.origin, {
            latitude: ev.latLng.lat(),
            longitude: ev.latLng.lng(),
          });
          const hit = state.current.features.find(
            (f) => f.kind === "plane" && f.closed && pointInRing(p, f.ring),
          );
          handler(hit?.planeKey ?? null);
        });
        map.addListener("idle", () => {
          draw();
          const c = map.getCenter();
          if (c && onCameraChange) {
            onCameraChange({
              center: { latitude: c.lat(), longitude: c.lng() },
              zoom: map.getZoom() ?? 20,
            });
          }
        });
        setReady(true);
      })
      .catch((e: Error) => setError(describeMapsError(e.message)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setCenter({ lat: origin.latitude, lng: origin.longitude });
  }, [origin.latitude, origin.longitude]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || recenterSignal === 0) return;
    map.setCenter({ lat: origin.latitude, lng: origin.longitude });
    map.setZoom(20);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenterSignal]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (layer === "tilted") {
      // Vue satellite inclinée de Maps JavaScript — pas de 3D photoréaliste.
      map.setMapTypeId(MAP_TYPE.satellite);
      map.setTilt(45);
      return;
    }
    map.setTilt(0);
    map.setMapTypeId(MAP_TYPE[layer as keyof typeof MAP_TYPE] ?? MAP_TYPE.satellite);
  }, [layer]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!pickMode) {
      markerRef.current?.setMap(null);
      markerRef.current = null;
      return;
    }
    const marker = new google.maps.Marker({
      map,
      position: { lat: origin.latitude, lng: origin.longitude },
      draggable: true,
      title: "Déplacez le repère sur le bâtiment",
    });
    marker.addListener("dragend", () => {
      const pos = marker.getPosition();
      if (pos && onPickLocation) onPickLocation({ latitude: pos.lat(), longitude: pos.lng() });
    });
    markerRef.current = marker;
    return () => {
      marker.setMap(null);
    };
  }, [pickMode, origin.latitude, origin.longitude, onPickLocation]);

  useEffect(() => {
    draw();
  }, [
    draw,
    features,
    modelOpacity,
    outlineOnly,
    swipePercent,
    points,
    hover,
    selectedPlaneKey,
    draft,
    drag,
    rect,
    rings,
    drawTool,
  ]);

  useEffect(() => {
    setPoints([]);
    setHover(null);
  }, [measure]);

  // Changer d'outil abandonne proprement le geste en cours : pas d'état fantôme.
  useEffect(() => {
    setDraft([]);
    setRect(null);
    setDrag(null);
    onDrawIssue?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawTool]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // Pendant un dessin, le glissement de la carte ne doit pas voler le geste.
    map.setOptions({ draggable: drawTool !== "draw_plane" && drawTool !== "add_obstacle" });
  }, [drawTool]);

  const finishDraft = useCallback(
    (ring: LocalPoint[]) => {
      const check = validateRoofRing(ring);
      if (!check.valid) {
        onDrawIssue?.(check.message);
        return;
      }
      onDrawIssue?.(null);
      setDraft([]);
      setHover(null);
      onPlaneDrawn?.(ring);
    },
    [onDrawIssue, onPlaneDrawn],
  );

  useEffect(() => {
    if (!drawTool) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDraft([]);
        setRect(null);
        setDrag(null);
        onDrawIssue?.(null);
      }
      if (e.key === "Enter" && draft.length >= 3) finishDraft(draft);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawTool, draft, finishDraft, onDrawIssue]);

  useEffect(() => {
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [draw]);

  const eventToLocal = (e: React.PointerEvent<HTMLCanvasElement>): LocalPoint | null => {
    const projection = overlayRef.current?.getProjection();
    const host = hostRef.current;
    if (!projection || !host) return null;
    const rect2 = host.getBoundingClientRect();
    const ll = projection.fromContainerPixelToLatLng(
      new google.maps.Point(e.clientX - rect2.left, e.clientY - rect2.top),
    );
    if (!ll) return null;
    return toLocal(origin, { latitude: ll.lat(), longitude: ll.lng() });
  };

  const snapPoint = (p: LocalPoint, altKey: boolean) =>
    snapDrawPoint(p, {
      rings: [...rings.map((r) => r.ring), draft],
      previous: draft.length ? draft[draft.length - 1]! : null,
      enabled: snapEnabled && !altKey,
    });

  const editing = drawTool !== null;
  const interactive = measure !== null || editing;

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = eventToLocal(e);
    if (!p) return;

    if (measure !== null && !editing) {
      const snapped = snapToModel(p, snapModel, 1.2);
      const next = [...points, snapped.point];
      setPoints(next);
      const result = measureOnModel(measure, next);
      if (result && onMeasured) onMeasured({ kind: measure, ...result, points: next });
      return;
    }

    if (drawTool === "draw_plane") {
      const snapped = snapPoint(p, e.altKey);
      // Re-cliquer le premier sommet ferme le contour.
      if (draft.length >= 3 && distance(snapped.point, draft[0]!) <= HANDLE_TOLERANCE_M) {
        finishDraft(draft);
        return;
      }
      setDraft([...draft, snapped.point]);
      onDrawIssue?.(null);
      return;
    }

    if (drawTool === "add_obstacle") {
      setRect({ start: p, current: p });
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    if (drawTool === "select") {
      const selected = rings.find((r) => r.key === selectedPlaneKey);
      if (selected) {
        const vertexIndex = selected.ring.findIndex((v) => distance(v, p) <= HANDLE_TOLERANCE_M);
        if (vertexIndex >= 0) {
          setDrag({ key: selected.key, index: vertexIndex, ring: selected.ring });
          e.currentTarget.setPointerCapture(e.pointerId);
          return;
        }
        // Clic sur une arête : insertion d'un sommet, puis glissement direct.
        const edge = nearestEdge(selected.ring, p);
        if (edge && edge.distance <= HANDLE_TOLERANCE_M) {
          const ring = [...selected.ring];
          ring.splice(edge.index + 1, 0, edge.point);
          setDrag({ key: selected.key, index: edge.index + 1, ring });
          e.currentTarget.setPointerCapture(e.pointerId);
          return;
        }
      }
      const hit = rings.find((r) => pointInRing(p, r.ring));
      onSelectPlane?.(hit?.key ?? null);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!interactive) return;
    const p = eventToLocal(e);
    if (!p) return;

    if (drag) {
      const snapped = snapDrawPoint(p, {
        rings: rings.filter((r) => r.key !== drag.key).map((r) => r.ring),
        enabled: snapEnabled && !e.altKey,
      });
      const ring = drag.ring.map((v, i) => (i === drag.index ? snapped.point : v));
      setDrag({ ...drag, ring });
      const check = validateRoofRing(ring);
      onDrawIssue?.(check.valid ? null : check.message);
      return;
    }

    if (rect) {
      setRect({ ...rect, current: p });
      return;
    }

    if (drawTool === "draw_plane") {
      const snapped = snapPoint(p, e.altKey);
      setHover({ point: snapped.point, label: snapped.label });
      return;
    }

    if (measure !== null) {
      const snapped = snapToModel(p, snapModel, 1.2);
      setHover({ point: snapped.point, label: snapped.label });
    }
  };

  const handlePointerUp = () => {
    if (drag) {
      const check = validateRoofRing(drag.ring);
      if (check.valid) {
        onDrawIssue?.(null);
        onRingChange?.(drag.key, drag.ring);
      } else {
        // Géométrie refusée : on revient au contour précédent, rien n'est écrit.
        onDrawIssue?.(check.message);
      }
      setDrag(null);
      return;
    }
    if (rect) {
      const ring = rectRing(rect.start, rect.current);
      setRect(null);
      if (validateRoofRing(ring).valid) onObstacleDrawn?.(ring);
      else onDrawIssue?.("Emprise trop petite : agrandissez le rectangle de l'obstacle.");
    }
  };

  return (
    <div ref={hostRef} className="relative h-full w-full overflow-hidden rounded-md bg-muted">
      <div ref={mapDivRef} className="absolute inset-0" />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 z-10 touch-none"
        style={{
          pointerEvents: interactive ? "auto" : "none",
          cursor: interactive ? "crosshair" : "default",
        }}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHover(null)}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onDoubleClick={() => {
          if (drawTool === "draw_plane" && draft.length >= 3) {
            finishDraft(draft);
            return;
          }
          if (!editing) setPoints([]);
        }}
      />

      {hover?.label && (
        <span className="pointer-events-none absolute left-2 top-2 z-20 rounded bg-background/90 px-2 py-1 text-xs font-medium">
          {hover.label}
        </span>
      )}

      {error && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-1 bg-background/95 p-4 text-center">
          <p className="text-sm font-semibold">Google Maps indisponible</p>
          <p className="text-xs text-muted-foreground">{error.message}</p>
          <p className="text-xs text-muted-foreground">
            Le modèle technique PVIA (toiture, panneaux, cotes) reste utilisable dans les autres
            onglets.
          </p>
        </div>
      )}

      {!error && !ready && (
        <div
          className="absolute inset-0 z-20 animate-pulse bg-muted"
          aria-label="Chargement de la carte"
          role="status"
        >
          <div className="absolute bottom-3 left-3 h-3 w-32 rounded bg-background/60" />
          <div className="absolute right-3 top-3 h-8 w-8 rounded bg-background/60" />
        </div>
      )}
    </div>
  );
}

/** Rectangle aligné sur les axes local (Est/Nord) entre deux points. */
export function rectRing(a: LocalPoint, b: LocalPoint): LocalPoint[] {
  return [
    { x: a.x, y: a.y },
    { x: b.x, y: a.y },
    { x: b.x, y: b.y },
    { x: a.x, y: b.y },
  ];
}

function pointInRing(p: LocalPoint, ring: LocalPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}

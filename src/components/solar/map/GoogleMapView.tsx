/// <reference types="google.maps" />
/**
 * Solar Studio — vue cartographique Google avec superposition du modèle PVIA.
 *
 * Le fond Google est une image de repérage. Tout ce qui est dessiné au-dessus
 * (pans, faîtages, obstacles, panneaux, mesures) appartient au modèle PVIA et
 * est calculé par son propre moteur géométrique.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toLatLon, toLocal, type LatLon, type LocalPoint } from "@/lib/solar/geo";
import {
  buildSnapModel,
  measureOnModel,
  snapToModel,
  type MapMeasureKind,
  type OverlayFeature,
} from "@/lib/solar/map/overlay-model";
import { browserMapsKey, countMapUsage, mapsTrackingId, type MapBaseLayer } from "@/lib/solar/map/provider";

let loaderPromise: Promise<typeof google.maps> | null = null;

/** Charge l'API Maps une seule fois par session : aucun rechargement facturé inutilement. */
export function loadGoogleMaps(): Promise<typeof google.maps> {
  if (loaderPromise) return loaderPromise;
  const key = browserMapsKey();
  if (!key) return Promise.reject(new Error("Clé cartographique non configurée."));
  loaderPromise = new Promise((resolve, reject) => {
    const w = window as unknown as { __pviaMapsReady?: () => void };
    w.__pviaMapsReady = () => resolve(google.maps);
    const script = document.createElement("script");
    const channel = mapsTrackingId();
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&loading=async&libraries=geometry&callback=__pviaMapsReady${
      channel ? `&channel=${encodeURIComponent(channel)}` : ""
    }`;
    script.async = true;
    script.onerror = () => reject(new Error("Chargement de la carte impossible."));
    document.head.appendChild(script);
    countMapUsage("map_load");
  });
  return loaderPromise;
}

const MAP_TYPE: Record<Exclude<MapBaseLayer, "photorealistic_3d" | "street_view">, string> = {
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
  onPickLocation?: (point: LatLon) => void;
  onSelectPlane?: (planeKey: string | null) => void;
  onMeasured?: (result: MapMeasureResult) => void;
  onCameraChange?: (view: { center: LatLon; zoom: number }) => void;
}

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
  onPickLocation,
  onSelectPlane,
  onMeasured,
  onCameraChange,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const overlayRef = useRef<google.maps.OverlayView | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [points, setPoints] = useState<LocalPoint[]>([]);
  const [hover, setHover] = useState<{ point: LocalPoint; label: string | null } | null>(null);

  const selectRef = useRef(onSelectPlane);
  selectRef.current = onSelectPlane;

  const snapModel = useMemo(() => buildSnapModel(features), [features]);
  const state = useRef({ features, modelOpacity, outlineOnly, swipePercent, points, hover, selectedPlaneKey, origin });
  state.current = { features, modelOpacity, outlineOnly, swipePercent, points, hover, selectedPlaneKey, origin };

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
      const px = projection.fromLatLngToContainerPixel(new google.maps.LatLng(ll.latitude, ll.longitude));
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
      ctx.lineWidth = f.planeKey && f.planeKey === s.selectedPlaneKey ? style.width + 2 : style.width;
      ctx.strokeStyle = f.planeKey && f.planeKey === s.selectedPlaneKey ? "#facc15" : style.stroke;
      ctx.stroke();
    }
    ctx.restore();

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
        if (cancelled || !hostRef.current) return;
        const map = new maps.Map(hostRef.current, {
          center: { lat: origin.latitude, lng: origin.longitude },
          zoom: 20,
          mapTypeId: MAP_TYPE.satellite,
          tilt: 0,
          streetViewControl: false,
          fullscreenControl: false,
          mapTypeControl: false,
          gestureHandling: "greedy",
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
          const p = toLocal(state.current.origin, { latitude: ev.latLng.lat(), longitude: ev.latLng.lng() });
          const hit = state.current.features.find((f) => f.kind === "plane" && f.closed && pointInRing(p, f.ring));
          handler(hit?.planeKey ?? null);
        });
        map.addListener("idle", () => {
          draw();
          const c = map.getCenter();
          if (c && onCameraChange) {
            onCameraChange({ center: { latitude: c.lat(), longitude: c.lng() }, zoom: map.getZoom() ?? 20 });
          }
        });
        setReady(true);
      })
      .catch((e: Error) => setError(e.message));
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
    if (!map) return;
    if (layer === "photorealistic_3d") {
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
  }, [draw, features, modelOpacity, outlineOnly, swipePercent, points, hover, selectedPlaneKey]);

  useEffect(() => {
    setPoints([]);
    setHover(null);
  }, [measure]);

  useEffect(() => {
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [draw]);

  const eventToLocal = (e: React.PointerEvent<HTMLCanvasElement>): LocalPoint | null => {
    const projection = overlayRef.current?.getProjection();
    const host = hostRef.current;
    if (!projection || !host) return null;
    const rect = host.getBoundingClientRect();
    const ll = projection.fromContainerPixelToLatLng(
      new google.maps.Point(e.clientX - rect.left, e.clientY - rect.top),
    );
    if (!ll) return null;
    return toLocal(origin, { latitude: ll.lat(), longitude: ll.lng() });
  };

  const interactive = measure !== null;

  return (
    <div ref={hostRef} className="relative h-full w-full overflow-hidden rounded-md bg-muted">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 z-10"
        style={{ pointerEvents: interactive ? "auto" : "none", cursor: interactive ? "crosshair" : "default" }}
        onPointerMove={(e) => {
          if (!interactive) return;
          const p = eventToLocal(e);
          if (!p) return;
          const snapped = snapToModel(p, snapModel, 1.2);
          setHover({ point: snapped.point, label: snapped.label });
        }}
        onPointerLeave={() => setHover(null)}
        onPointerDown={(e) => {
          if (!interactive) return;
          const p = eventToLocal(e);
          if (!p) return;
          const snapped = snapToModel(p, snapModel, 1.2);
          const next = [...points, snapped.point];
          setPoints(next);
          const result = measureOnModel(measure, next);
          if (result && onMeasured) onMeasured({ kind: measure, ...result, points: next });
        }}
        onDoubleClick={() => setPoints([])}
      />

      {hover?.label && (
        <span className="pointer-events-none absolute left-2 top-2 z-20 rounded bg-background/90 px-2 py-1 text-xs font-medium">
          {hover.label}
        </span>
      )}

      {(error || !ready) && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/80 p-4 text-center text-xs text-muted-foreground">
          {error ?? "Chargement de la carte…"}
        </div>
      )}
    </div>
  );
}

function pointInRing(p: LocalPoint, ring: LocalPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

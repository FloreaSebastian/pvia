/**
 * Solar Studio — fournisseur de fond visuel cartographique.
 *
 * RÈGLE FONDAMENTALE : le fond de carte est un VISUEL. Il n'est jamais la
 * source d'une mesure technique PVIA. La géométrie technique provient de l'IGN,
 * du LiDAR, du MNT/MNS/MNH, d'une mesure utilisateur, d'une visite terrain ou
 * d'un import — jamais d'un tracé décalqué sur l'imagerie d'un tiers.
 *
 * L'abstraction `MapVisualProvider` permet de remplacer Google demain sans
 * toucher au moteur géométrique.
 */

export type MapBaseLayer = "plan" | "satellite" | "hybrid" | "photorealistic_3d" | "street_view";

export const MAP_LAYER_LABEL: Record<MapBaseLayer, string> = {
  plan: "Plan",
  satellite: "Satellite",
  hybrid: "Hybride",
  photorealistic_3d: "3D réelle",
  street_view: "Street View",
};

export interface MapVisualProvider {
  readonly id: string;
  readonly name: string;
  /** Mention légale affichée en permanence sur la vue. */
  readonly attribution: string;
  /** Couches que le fournisseur peut afficher, sous réserve de couverture. */
  readonly layers: MapBaseLayer[];
  /** Ce que la licence interdit d'utiliser comme source technique. */
  readonly derivativeRestriction: string;
  isConfigured(): boolean;
}

export const GOOGLE_MAPS_PROVIDER: MapVisualProvider = {
  id: "google_maps",
  name: "Google Maps Platform",
  attribution: "Fond cartographique © Google — Imagerie © Google, Maxar, IGN",
  layers: ["plan", "satellite", "hybrid", "photorealistic_3d", "street_view"],
  derivativeRestriction:
    "Le fond Google sert au repérage visuel. Aucun contour, maillage 3D ni mesure technique n'est dérivé ni enregistré à partir de son imagerie.",
  isConfigured: () => Boolean(browserMapsKey()),
};

export function browserMapsKey(): string | null {
  const key = import.meta.env["VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY"] as string | undefined;
  return key && key.length > 0 ? key : null;
}

export function mapsTrackingId(): string {
  return (import.meta.env["VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID"] as string | undefined) ?? "";
}

/* ------------------------------ Budget d'API ------------------------------ */

export type MapUsageKind = "map_load" | "place_search" | "street_view" | "photorealistic_3d";

const USAGE_KEY = "pvia.solar.map.usage";

export interface MapUsage {
  day: string;
  counts: Record<MapUsageKind, number>;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyUsage(): MapUsage {
  return { day: today(), counts: { map_load: 0, place_search: 0, street_view: 0, photorealistic_3d: 0 } };
}

export function readMapUsage(): MapUsage {
  if (typeof window === "undefined") return emptyUsage();
  try {
    const raw = window.localStorage.getItem(USAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as MapUsage) : null;
    if (!parsed || parsed.day !== today()) return emptyUsage();
    return { day: parsed.day, counts: { ...emptyUsage().counts, ...parsed.counts } };
  } catch {
    return emptyUsage();
  }
}

/** Comptage local des appels facturables, pour éviter les requêtes répétitives. */
export function countMapUsage(kind: MapUsageKind): MapUsage {
  const usage = readMapUsage();
  usage.counts[kind] = (usage.counts[kind] ?? 0) + 1;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(USAGE_KEY, JSON.stringify(usage));
    } catch {
      /* stockage indisponible : le comptage reste en mémoire de session */
    }
  }
  return usage;
}

export const MAP_USAGE_LABEL: Record<MapUsageKind, string> = {
  map_load: "Chargements de carte",
  place_search: "Recherches d'adresse",
  street_view: "Sessions Street View",
  photorealistic_3d: "Sessions 3D réelle",
};

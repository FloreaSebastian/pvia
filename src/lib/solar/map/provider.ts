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

/**
 * `tilted` = vue satellite inclinée (Maps JavaScript API, tilt 45°).
 * Ce n'est PAS la 3D photoréaliste (Photorealistic 3D Maps / bibliothèque
 * `maps3d`), qui n'est pas utilisée ici et dont la couverture est partielle.
 */
export type MapBaseLayer = "plan" | "satellite" | "hybrid" | "tilted" | "street_view";

export const MAP_LAYER_LABEL: Record<MapBaseLayer, string> = {
  plan: "Plan",
  satellite: "Satellite",
  hybrid: "Hybride",
  tilted: "Vue inclinée",
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
  layers: ["plan", "satellite", "hybrid", "tilted", "street_view"],
  derivativeRestriction:
    "Le fond Google sert au repérage visuel. Aucun contour, maillage 3D ni mesure technique n'est dérivé ni enregistré à partir de son imagerie.",
  isConfigured: () => Boolean(browserMapsKey()),
};

/* ------------------------------- Clé navigateur --------------------------- */

export type MapKeySource = "pvia" | "pvia_dev" | "lovable_connector" | "none";

/**
 * Ordre de résolution : la clé PVIA dédiée (autorisée pour pvia.fr) prime sur
 * la clé du connecteur géré, qui n'est autorisée que sur *.lovable.app.
 *
 * Cette clé est publique par construction (elle part dans le navigateur).
 * Sa sécurité repose exclusivement sur les restrictions Google : referrers
 * HTTP, APIs autorisées, quotas et alertes.
 */
/**
 * Clé PVIA transmise au démarrage par le serveur (secret `GOOGLE_API_KEY`),
 * pour ne pas dépendre d'une variable publique de build.
 */
let runtimeKey: string | null = null;
let runtimeKeySource: MapKeySource = "none";

/**
 * `source` distingue explicitement la clé de production de la clé de
 * développement : aucun repli ne doit faire fonctionner localhost avec la clé
 * de production, ni un domaine PVIA avec la clé de développement.
 */
export function setRuntimeMapsKey(key: string | null, source: MapKeySource = "pvia"): void {
  const usable = key && key.length > 0 ? key : null;
  runtimeKey = usable;
  runtimeKeySource = usable ? source : "none";
}

function isDevOrigin(): boolean {
  if (typeof window === "undefined") return Boolean(import.meta.env.DEV);
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1";
}

export function browserMapsKey(): string | null {
  if (runtimeKey) return runtimeKey;
  if (isDevOrigin()) {
    const dev = import.meta.env["VITE_GOOGLE_MAPS_DEV_KEY"] as string | undefined;
    return dev && dev.length > 0 ? dev : null;
  }
  const own = import.meta.env["VITE_GOOGLE_MAPS_BROWSER_KEY"] as string | undefined;
  if (own && own.length > 0) return own;
  const managed = import.meta.env["VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY"] as string | undefined;
  return managed && managed.length > 0 ? managed : null;
}

export function mapsKeySource(): MapKeySource {
  if (runtimeKey) return runtimeKeySource;
  if (isDevOrigin()) {
    const dev = import.meta.env["VITE_GOOGLE_MAPS_DEV_KEY"] as string | undefined;
    return dev && dev.length > 0 ? "pvia_dev" : "none";
  }
  const own = import.meta.env["VITE_GOOGLE_MAPS_BROWSER_KEY"] as string | undefined;
  if (own && own.length > 0) return "pvia";
  const managed = import.meta.env["VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY"] as string | undefined;
  return managed && managed.length > 0 ? "lovable_connector" : "none";
}

/** Identifiant de build, pour savoir quelle version est réellement en ligne. */
export function buildIdentifier(): string {
  const id = import.meta.env["VITE_BUILD_ID"] as string | undefined;
  return id && id.length > 0 ? id : "inconnu";
}

/** Empreinte non réversible pour le diagnostic : jamais la clé complète. */
export function maskMapsKey(key: string | null): string {
  if (!key) return "absente";
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

/** Map ID optionnel (styles cloud). Aucun Map ID de démonstration n'est codé. */
export function mapsMapId(): string | null {
  const id = import.meta.env["VITE_GOOGLE_MAPS_MAP_ID"] as string | undefined;
  return id && id.length > 0 ? id : null;
}

export function mapsTrackingId(): string {
  return (import.meta.env["VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID"] as string | undefined) ?? "";
}

/**
 * La connexion Google gérée par Lovable est restreinte aux domaines
 * `*.lovable.app` / `*.lovableproject.com`. Sur un domaine PVIA, elle échouera.
 */
export function keyMatchesHost(host: string, source: MapKeySource): boolean {
  const local = /^localhost$|^127\.0\.0\.1$/.test(host);
  if (source === "none") return false;
  // Clé de développement : strictement l'origine locale.
  if (source === "pvia_dev") return local;
  // Clé de production : domaines PVIA, jamais localhost.
  if (source === "pvia") return !local;
  return /(^|\.)lovable\.app$|(^|\.)lovableproject\.com$/.test(host) || local;
}

/* --------------------------- Erreurs compréhensibles ---------------------- */

export interface MapsErrorInfo {
  /** Code technique Google, conservé pour les journaux. */
  code: string;
  /** Message exploitable par un utilisateur métier. */
  message: string;
}

export function describeMapsError(code: string): MapsErrorInfo {
  switch (code) {
    case "RefererNotAllowedMapError":
      return {
        code,
        message:
          "Google Maps n'est pas autorisé pour ce domaine. Ajoutez ce domaine aux restrictions de la clé (referrers HTTP).",
      };
    case "ApiNotActivatedMapError":
      return { code, message: "L'API Maps JavaScript n'est pas activée sur le projet Google." };
    case "InvalidKeyMapError":
      return { code, message: "La clé Google Maps est invalide ou révoquée." };
    case "MissingKeyMapError":
      return { code, message: "Aucune clé Google Maps n'est configurée." };
    case "ExpiredKeyMapError":
      return { code, message: "La clé Google Maps a expiré." };
    case "OverQuotaMapError":
    case "BillingNotEnabledMapError":
      return { code, message: "Quota ou facturation Google Maps insuffisants pour ce projet." };
    case "PLACES_NOT_ENABLED":
      return { code, message: "L'API Places (New) n'est pas activée sur le projet Google." };
    case "SCRIPT_LOAD_FAILED":
      return { code, message: "Google Maps n'a pas pu être chargé (réseau ou domaine non autorisé)." };
    case "NOT_CONFIGURED":
      return { code, message: "Aucune clé Google Maps configurée pour ce domaine." };
    default:
      return { code, message: "Google Maps indisponible pour le moment." };
  }
}

/* ------------------------------ Diagnostic -------------------------------- */

export interface MapsDiagnostics {
  keyPresent: boolean;
  keySource: MapKeySource;
  keyMasked: string;
  mapId: string | null;
  host: string;
  hostAllowedByKey: boolean;
  apiLoaded: boolean;
  placesConfigured: boolean;
  photorealistic3d: "non utilisé";
  tiltedView: boolean;
  lastError: MapsErrorInfo | null;
  buildId: string;
}

let lastError: MapsErrorInfo | null = null;
let apiLoaded = false;

export function recordMapsError(code: string): MapsErrorInfo {
  lastError = describeMapsError(code);
  console.error(`[google-maps] ${lastError.code}: ${lastError.message}`);
  return lastError;
}

export function markMapsLoaded(): void {
  apiLoaded = true;
  lastError = null;
}

export function readMapsDiagnostics(placesConfigured: boolean): MapsDiagnostics {
  const key = browserMapsKey();
  const source = mapsKeySource();
  const host = typeof window === "undefined" ? "" : window.location.hostname;
  return {
    keyPresent: Boolean(key),
    keySource: source,
    keyMasked: maskMapsKey(key),
    mapId: mapsMapId(),
    host,
    hostAllowedByKey: keyMatchesHost(host, source),
    apiLoaded,
    placesConfigured,
    photorealistic3d: "non utilisé",
    tiltedView: apiLoaded,
    lastError,
  };
}

/* ------------------------------ Budget d'API ------------------------------ */

export type MapUsageKind = "map_load" | "place_search" | "street_view" | "tilted";

const USAGE_KEY = "pvia.solar.map.usage";

export interface MapUsage {
  day: string;
  counts: Record<MapUsageKind, number>;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyUsage(): MapUsage {
  return { day: today(), counts: { map_load: 0, place_search: 0, street_view: 0, tilted: 0 } };
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
  tilted: "Passages en vue inclinée",
};

/**
 * Solar Studio — connecteur IGN Géoplateforme (côté serveur uniquement).
 *
 * UN SEUL point d'entrée vers l'IGN : URL, version, délai, réessai borné,
 * cache, erreurs, attribution et journalisation sont centralisés ici.
 * Aucun composant React n'appelle jamais l'IGN directement.
 *
 * Solar Studio doit rester utilisable si l'IGN est indisponible : chaque
 * méthode renvoie un ProviderResult en échec explicite, jamais une exception.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { LatLon } from "../geo";
import {
  DATASET_LABEL,
  type BuildingFootprint,
  type CoverageStatus,
  type DatasetKind,
  type ElevationSampleResult,
  type GeocodeCandidate,
  type ImageryLayer,
  type ProviderError,
  type ProviderResult,
  type SourceMetadata,
} from "./types";

type SB = SupabaseClient<Database>;

const ATTRIBUTION = "© IGN — Géoplateforme";
const LICENSE = "Licence Ouverte / Etalab 2.0";
const TIMEOUT_MS = 8000;
const MAX_ATTEMPTS = 2;
const CACHE_TTL_DAYS = 30;

const BASE = {
  geocode: "https://data.geopf.fr/geocodage/search",
  reverse: "https://data.geopf.fr/geocodage/reverse",
  elevation: "https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json",
  wmts: "https://data.geopf.fr/wmts",
  wfs: "https://data.geopf.fr/wfs/ows",
} as const;

function meta(
  dataset: string,
  kind: DatasetKind,
  extra: Partial<SourceMetadata> = {},
): SourceMetadata {
  return {
    provider: "IGN",
    dataset,
    dataset_kind: kind,
    dataset_version: null,
    crs: "EPSG:4326",
    resolution_m: null,
    bbox: null,
    acquisition_date: null,
    attribution: ATTRIBUTION,
    license: LICENSE,
    documented_accuracy: null,
    fetched_at: new Date().toISOString(),
    ...extra,
  };
}

function fail<T>(code: ProviderError["code"], message: string, dataset: string, kind: DatasetKind): ProviderResult<T> {
  return { ok: false, error: { code, message }, metadata: meta(dataset, kind) };
}

/** Requête HTTP bornée : délai maximal, un réessai, jamais d'exception qui remonte. */
async function request(url: string): Promise<{ ok: true; json: unknown } | { ok: false; error: ProviderError }> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json", "User-Agent": "PVIA-SolarStudio/2.0" },
      });
      clearTimeout(timer);
      if (res.status === 429) {
        if (attempt === MAX_ATTEMPTS) return { ok: false, error: { code: "rate_limited", message: "429" } };
        continue;
      }
      if (!res.ok) {
        if (attempt === MAX_ATTEMPTS) {
          console.warn(`[ign] ${res.status} ${url}`);
          return { ok: false, error: { code: "unavailable", message: `HTTP ${res.status}` } };
        }
        continue;
      }
      return { ok: true, json: await res.json() };
    } catch (e) {
      clearTimeout(timer);
      const aborted = e instanceof Error && e.name === "AbortError";
      if (attempt === MAX_ATTEMPTS) {
        console.warn(`[ign] ${aborted ? "timeout" : "erreur réseau"} ${url}`);
        return { ok: false, error: { code: aborted ? "timeout" : "unavailable", message: String(e) } };
      }
    }
  }
  return { ok: false, error: { code: "unavailable", message: "épuisement des tentatives" } };
}

/* ---------------------------------- Cache --------------------------------- */
/* Uniquement des données publiques IGN : mutualisables entre entreprises.
   Aucune correction, mesure, photo ou interprétation client n'y transite. */

function roundKey(value: number, decimals = 5): string {
  return value.toFixed(decimals);
}

async function cacheGet(sb: SB | null, key: string): Promise<unknown | null> {
  if (!sb) return null;
  const { data } = await sb
    .from("solar_geo_cache")
    .select("payload, expires_at")
    .eq("cache_key", key)
    .maybeSingle();
  if (!data) return null;
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) return null;
  return (data.payload as { value?: unknown } | null)?.value ?? null;
}

async function cacheSet(
  sb: SB | null,
  key: string,
  value: unknown,
  info: { dataset: string; resolution_m?: number | null; bbox?: unknown },
): Promise<void> {
  if (!sb) return;
  const expires = new Date(Date.now() + CACHE_TTL_DAYS * 86_400_000).toISOString();
  await sb.from("solar_geo_cache").upsert(
    {
      cache_key: key,
      provider: "IGN",
      dataset: info.dataset,
      crs: "EPSG:4326",
      resolution_m: info.resolution_m ?? null,
      bbox: (info.bbox ?? {}) as never,
      payload: { value } as never,
      attribution: ATTRIBUTION,
      license: LICENSE,
      fetched_at: new Date().toISOString(),
      expires_at: expires,
    },
    { onConflict: "cache_key" },
  );
}

/* -------------------------------- Provider -------------------------------- */

export class IgnGeoProvider {
  readonly name = "IGN";
  readonly attribution = ATTRIBUTION;

  constructor(private readonly sb: SB | null = null) {}

  /* Géocodage --------------------------------------------------------------- */

  async search(query: string, limit = 8): Promise<ProviderResult<GeocodeCandidate[]>> {
    const q = query.trim();
    if (q.length < 3) return fail("no_coverage", "Requête trop courte.", "Base Adresse Nationale", "geocoding");
    const url = `${BASE.geocode}?index=address&limit=${limit}&q=${encodeURIComponent(q)}`;
    const res = await request(url);
    if (!res.ok) return { ok: false, error: res.error, metadata: meta("Base Adresse Nationale", "geocoding") };
    return {
      ok: true,
      data: parseGeocode(res.json),
      metadata: meta("Base Adresse Nationale", "geocoding", { dataset_version: "geopf/geocodage" }),
    };
  }

  async reverse(point: LatLon): Promise<ProviderResult<GeocodeCandidate[]>> {
    const url = `${BASE.reverse}?index=address&limit=1&lon=${point.longitude}&lat=${point.latitude}`;
    const res = await request(url);
    if (!res.ok) return { ok: false, error: res.error, metadata: meta("Base Adresse Nationale", "geocoding") };
    return { ok: true, data: parseGeocode(res.json), metadata: meta("Base Adresse Nationale", "geocoding") };
  }

  /* Fonds cartographiques ---------------------------------------------------- */

  getLayer(kind: "plan" | "orthophoto"): ProviderResult<ImageryLayer> {
    const layer = kind === "orthophoto" ? "HR.ORTHOIMAGERY.ORTHOPHOTOS" : "GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2";
    const format = kind === "orthophoto" ? "image/jpeg" : "image/png";
    const style = kind === "orthophoto" ? "normal" : "normal";
    const template =
      `${BASE.wmts}?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile&LAYER=${layer}` +
      `&STYLE=${style}&FORMAT=${encodeURIComponent(format)}&TILEMATRIXSET=PM` +
      `&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`;
    return {
      ok: true,
      data: { tile_url_template: template, min_zoom: 0, max_zoom: kind === "orthophoto" ? 21 : 19, tile_size: 256 },
      metadata: meta(
        kind === "orthophoto" ? "BD ORTHO" : "Plan IGN v2",
        "imagery",
        { crs: "EPSG:3857", resolution_m: kind === "orthophoto" ? 0.2 : null },
      ),
    };
  }

  /* Altimétrie --------------------------------------------------------------- */

  /** Altitudes du SOL (RGE ALTI). Utilisé comme MNT. */
  async sample(points: LatLon[]): Promise<ProviderResult<ElevationSampleResult[]>> {
    if (!points.length) return { ok: true, data: [], metadata: meta("RGE ALTI", "terrain_model") };
    const chunks: LatLon[][] = [];
    for (let i = 0; i < points.length; i += 40) chunks.push(points.slice(i, i + 40));

    const out: ElevationSampleResult[] = [];
    for (const chunk of chunks) {
      const lon = chunk.map((p) => p.longitude.toFixed(6)).join("|");
      const lat = chunk.map((p) => p.latitude.toFixed(6)).join("|");
      const key = `ign:alti:${hashKey(`${lon}#${lat}`)}`;
      const cached = (await cacheGet(this.sb, key)) as ElevationSampleResult[] | null;
      if (cached) {
        out.push(...cached);
        continue;
      }
      const url = `${BASE.elevation}?lon=${lon}&lat=${lat}&resource=ign_rge_alti_wld&delimiter=|&indent=false&measures=false&zonly=false`;
      const res = await request(url);
      if (!res.ok) return { ok: false, error: res.error, metadata: meta("RGE ALTI", "terrain_model") };
      const parsed = parseElevation(res.json);
      if (!parsed) return fail("invalid_response", "Réponse altimétrique inexploitable.", "RGE ALTI", "terrain_model");
      await cacheSet(this.sb, key, parsed, { dataset: "RGE ALTI", resolution_m: 1 });
      out.push(...parsed);
    }
    return {
      ok: true,
      data: out,
      metadata: meta("RGE ALTI", "terrain_model", {
        resolution_m: 1,
        documented_accuracy: "RGE ALTI 1 m — précision altimétrique publiée par l'IGN selon la zone",
      }),
    };
  }

  /** Grille MNT autour d'un centre. */
  async sampleGrid(center: LatLon, radius_m: number, step_m: number): Promise<ProviderResult<ElevationSampleResult[]>> {
    const points: LatLon[] = [];
    const mLat = 111_320;
    const mLon = 111_320 * Math.cos((center.latitude * Math.PI) / 180);
    for (let dy = -radius_m; dy <= radius_m; dy += step_m) {
      for (let dx = -radius_m; dx <= radius_m; dx += step_m) {
        points.push({
          latitude: center.latitude + dy / mLat,
          longitude: center.longitude + dx / (mLon || 1),
        });
      }
    }
    if (points.length > 400) points.length = 400; // borne dure : jamais une commune entière
    return this.sample(points);
  }

  /* Emprises de bâtiments ---------------------------------------------------- */

  async findAt(point: LatLon): Promise<ProviderResult<BuildingFootprint[]>> {
    const d = 0.0004;
    const bbox = `${point.longitude - d},${point.latitude - d},${point.longitude + d},${point.latitude + d},EPSG:4326`;
    const key = `ign:bdtopo:batiment:${roundKey(point.latitude)},${roundKey(point.longitude)}`;
    const cached = (await cacheGet(this.sb, key)) as BuildingFootprint[] | null;
    if (cached) return { ok: true, data: cached, metadata: meta("BD TOPO — bâtiment", "building_footprint") };

    const url =
      `${BASE.wfs}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=BDTOPO_V3:batiment` +
      `&OUTPUTFORMAT=application/json&SRSNAME=EPSG:4326&COUNT=5&BBOX=${encodeURIComponent(bbox)}`;
    const res = await request(url);
    if (!res.ok) return { ok: false, error: res.error, metadata: meta("BD TOPO — bâtiment", "building_footprint") };
    const parsed = parseFootprints(res.json);
    await cacheSet(this.sb, key, parsed, { dataset: "BD TOPO — bâtiment" });
    return {
      ok: true,
      data: parsed,
      metadata: meta("BD TOPO — bâtiment", "building_footprint", { dataset_version: "BDTOPO_V3" }),
    };
  }

  /* Couverture --------------------------------------------------------------- */

  /**
   * Disponibilité RÉELLE, testée par sondage, jamais supposée.
   * Le LiDAR HD brut n'est pas exploitable depuis ce runtime : il est déclaré
   * indisponible plutôt que simulé (voir rapport de phase).
   */
  async checkCoverage(point: LatLon): Promise<CoverageStatus[]> {
    const [elevation, footprint] = await Promise.all([this.sample([point]), this.findAt(point)]);

    const altitude = elevation.ok ? elevation.data[0]?.altitude_m ?? null : null;
    const status = (
      kind: DatasetKind,
      available: boolean,
      dataset: string | null,
      detail: string,
      resolution: number | null = null,
    ): CoverageStatus => ({
      dataset_kind: kind,
      label: DATASET_LABEL[kind],
      available,
      provider: available ? "IGN" : null,
      dataset,
      detail,
      resolution_m: resolution,
      acquisition_date: null,
      attribution: available ? ATTRIBUTION : null,
    });

    return [
      status("imagery", true, "BD ORTHO", "Tuiles orthophotographiques Géoplateforme.", 0.2),
      status(
        "terrain_model",
        elevation.ok && altitude != null,
        "RGE ALTI",
        elevation.ok
          ? altitude != null
            ? `Altitude du sol : ${altitude.toFixed(1)} m`
            : "Pas de valeur altimétrique sur ce point."
          : "Service altimétrique indisponible.",
        1,
      ),
      status(
        "surface_model",
        false,
        null,
        "Modèle de surface non connecté : nécessite un service de traitement raster externe.",
      ),
      status(
        "height_model",
        false,
        null,
        "Modèle de hauteur non connecté : sera dérivé de MNS − MNT quand le MNS sera disponible.",
      ),
      status(
        "lidar",
        false,
        null,
        "LiDAR HD non exploitable depuis ce serveur (découpage de dalles LAZ impossible).",
      ),
      status(
        "building_footprint",
        footprint.ok && footprint.data.length > 0,
        "BD TOPO — bâtiment",
        footprint.ok
          ? footprint.data.length
            ? `${footprint.data.length} bâtiment(s) trouvé(s) à cette adresse.`
            : "Aucune emprise de bâtiment à cette position."
          : "Service des emprises indisponible.",
      ),
    ];
  }
}

/* -------------------------------- Parsers --------------------------------- */

function parseGeocode(json: unknown): GeocodeCandidate[] {
  const features = (json as { features?: unknown[] })?.features ?? [];
  const out: GeocodeCandidate[] = [];
  for (const f of features) {
    const feature = f as {
      geometry?: { coordinates?: number[] };
      properties?: Record<string, unknown>;
    };
    const c = feature.geometry?.coordinates;
    if (!Array.isArray(c) || c.length < 2) continue;
    const p = feature.properties ?? {};
    out.push({
      label: String(p["label"] ?? ""),
      address: String(p["name"] ?? p["label"] ?? ""),
      postal_code: String(p["postcode"] ?? ""),
      city: String(p["city"] ?? ""),
      longitude: Number(c[0]),
      latitude: Number(c[1]),
      score: typeof p["score"] === "number" ? p["score"] : 0,
      kind: String(p["type"] ?? "inconnu"),
    });
  }
  return out;
}

function parseElevation(json: unknown): ElevationSampleResult[] | null {
  const elevations = (json as { elevations?: unknown[] })?.elevations;
  if (!Array.isArray(elevations)) return null;
  const out: ElevationSampleResult[] = [];
  for (const e of elevations) {
    const item = e as { lon?: number; lat?: number; z?: number };
    if (typeof item.z !== "number" || item.z <= -99_000) continue;
    out.push({ latitude: Number(item.lat), longitude: Number(item.lon), altitude_m: item.z });
  }
  return out;
}

function parseFootprints(json: unknown): BuildingFootprint[] {
  const features = (json as { features?: unknown[] })?.features ?? [];
  const out: BuildingFootprint[] = [];
  for (const f of features) {
    const feature = f as {
      id?: string;
      geometry?: { type?: string; coordinates?: unknown };
      properties?: Record<string, unknown>;
    };
    const ring = firstRing(feature.geometry);
    if (!ring.length) continue;
    const p = feature.properties ?? {};
    out.push({
      ring,
      height_m: typeof p["hauteur"] === "number" ? p["hauteur"] : null,
      levels: typeof p["nombre_d_etages"] === "number" ? p["nombre_d_etages"] : null,
      source_id: feature.id ? String(feature.id) : null,
    });
  }
  return out;
}

function firstRing(geometry: { type?: string; coordinates?: unknown } | undefined): LatLon[] {
  const coords = geometry?.coordinates;
  if (!Array.isArray(coords)) return [];
  const ring =
    geometry?.type === "MultiPolygon"
      ? ((coords as unknown[][])[0] as unknown[])?.[0]
      : (coords as unknown[])[0];
  if (!Array.isArray(ring)) return [];
  return (ring as unknown[])
    .map((pair) => (Array.isArray(pair) ? { longitude: Number(pair[0]), latitude: Number(pair[1]) } : null))
    .filter((p): p is LatLon => p !== null && Number.isFinite(p.latitude) && Number.isFinite(p.longitude));
}

function hashKey(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

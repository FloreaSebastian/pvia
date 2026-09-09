/**
 * Solar Studio — helpers serveur (droits, géométrie persistée, chargement).
 * Importé uniquement par src/lib/solar*.functions.ts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { buildRoofPlanes } from "./solar/roof";
import { deriveRoofEdges, type RoofEdge } from "./solar/edges";
import { geometryFingerprint } from "./solar/hash";
import { computeSolarSummary } from "./solar/summary";
import {
  buildQualityReport,
  CONFIDENCE_META,
  defaultConfidence,
  type ConfidenceLevel,
  type QualityBreakdownRow,
  type SourceType,
  type VerificationStatus,
} from "./solar/provenance";
import type { BuildingParams, PlacedModule, RoofPlaneGeometry, SolarQualityLevel } from "./solar/types";
import { DEFAULT_BUILDING_PARAMS } from "./solar/types";
import type { TerrainGrid } from "./solar/terrain";

type SB = SupabaseClient<Database>;

export type SolarModelRow = Database["public"]["Tables"]["solar_models"]["Row"];
export type SolarBuildingRow = Database["public"]["Tables"]["solar_buildings"]["Row"];
export type SolarRoofPlaneRow = Database["public"]["Tables"]["solar_roof_planes"]["Row"];
export type SolarProvenanceRow = Database["public"]["Tables"]["solar_provenance"]["Row"];
export type SolarMeasurementRow = Database["public"]["Tables"]["solar_measurements"]["Row"];

/** Lecture : tout membre actif de l'entreprise. */
export async function assertSolarMember(sb: SB, companyId: string, userId: string) {
  const { data, error } = await sb.rpc("is_company_member", { _company_id: companyId, _user_id: userId });
  if (error) throw new Error("Vérification des droits impossible.");
  if (data !== true) throw new Error("Accès refusé.");
}

/** Écriture : rôle de gestion ET entreprise en droit d'écrire (abonnement). */
export async function assertSolarManage(sb: SB, companyId: string, userId: string) {
  const { data, error } = await sb.rpc("can_manage_company", { _company_id: companyId, _user_id: userId });
  if (error) throw new Error("Vérification des droits impossible.");
  if (data !== true) throw new Error("Droits insuffisants.");
  const guard = await import("./plan-guard.server");
  await guard.assertCompanyWriteAccess(companyId, userId);
}

export async function loadModelScoped(sb: SB, companyId: string, modelId: string): Promise<SolarModelRow> {
  const { data, error } = await sb
    .from("solar_models")
    .select("*")
    .eq("id", modelId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw new Error("Modèle introuvable.");
  if (!data) throw new Error("Modèle introuvable.");
  return data;
}

/**
 * Détection de conflit : un onglet resté ouvert ne doit pas écraser
 * silencieusement le travail enregistré entre-temps par quelqu'un d'autre.
 */
export function assertGeometryVersion(model: SolarModelRow, expected?: number | null) {
  if (expected == null) return;
  if (model.geometry_version !== expected) {
    throw new Error(
      "Une version plus récente de ce modèle existe (modifié depuis un autre onglet ou par un collègue). Rechargez la page avant d'enregistrer.",
    );
  }
}

/** Paramètres d'un bâtiment, avec repli sur les valeurs par défaut. */
export function readBuildingParams(row: SolarBuildingRow | null): BuildingParams {
  const raw = (row?.params ?? {}) as Partial<BuildingParams>;
  return {
    roof_type: (row?.roof_type as BuildingParams["roof_type"]) ?? DEFAULT_BUILDING_PARAMS.roof_type,
    width_m: numberOr(raw.width_m, DEFAULT_BUILDING_PARAMS.width_m),
    depth_m: numberOr(raw.depth_m, DEFAULT_BUILDING_PARAMS.depth_m),
    wall_height_m: numberOr(row?.wall_height_m, DEFAULT_BUILDING_PARAMS.wall_height_m),
    tilt_deg: numberOr(raw.tilt_deg, DEFAULT_BUILDING_PARAMS.tilt_deg),
    azimuth_deg: numberOr(row?.rotation_deg, DEFAULT_BUILDING_PARAMS.azimuth_deg),
    overhang_m: numberOr(raw.overhang_m, DEFAULT_BUILDING_PARAMS.overhang_m),
  };
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Géométrie d'un pan telle que stockée : { key, points, frame }. */
export function planeGeometryFromRow(row: SolarRoofPlaneRow): RoofPlaneGeometry | null {
  const raw = row.polygon as unknown as
    | { key?: string; points?: { x: number; y: number }[]; frame?: RoofPlaneGeometry["frame"] }
    | null;
  if (!raw?.key || !raw.points || !raw.frame) return null;
  return {
    key: raw.key,
    name: row.name,
    azimuth_deg: row.azimuth_deg,
    tilt_deg: row.tilt_deg,
    area_m2: row.area_m2,
    polygon: raw.points,
    frame: raw.frame,
    eave_height_m: row.eave_height_m ?? 0,
    ridge_height_m: row.ridge_height_m ?? 0,
  };
}

/**
 * Recalcule les pans depuis les paramètres du bâtiment et synchronise la base.
 * Les pans existants sont mis à jour (clé stable), les pans disparus supprimés :
 * une modification de toiture ne détruit donc pas inutilement les implantations.
 */
export async function syncRoofPlanes(
  sb: SB,
  companyId: string,
  modelId: string,
  building: SolarBuildingRow,
  params: BuildingParams,
): Promise<SolarRoofPlaneRow[]> {
  const geometry = buildRoofPlanes(params);
  const { data: existing, error } = await sb
    .from("solar_roof_planes")
    .select("*")
    .eq("model_id", modelId)
    .eq("company_id", companyId);
  if (error) throw new Error("Lecture des pans impossible.");

  const byKey = new Map<string, SolarRoofPlaneRow>();
  for (const row of existing ?? []) {
    const g = planeGeometryFromRow(row);
    if (g) byKey.set(g.key, row);
  }

  const kept: SolarRoofPlaneRow[] = [];
  for (const plane of geometry) {
    const payload = {
      company_id: companyId,
      model_id: modelId,
      building_id: building.id,
      name: plane.name,
      azimuth_deg: plane.azimuth_deg,
      tilt_deg: plane.tilt_deg,
      area_m2: plane.area_m2,
      eave_height_m: plane.eave_height_m,
      ridge_height_m: plane.ridge_height_m,
      polygon: { key: plane.key, points: plane.polygon, frame: plane.frame } as never,
    };
    const current = byKey.get(plane.key);
    if (current) {
      const { data, error: upErr } = await sb
        .from("solar_roof_planes")
        .update(payload)
        .eq("id", current.id)
        .eq("company_id", companyId)
        .select("*")
        .single();
      if (upErr) throw new Error("Mise à jour du pan impossible.");
      kept.push(data);
      byKey.delete(plane.key);
    } else {
      const { data, error: insErr } = await sb
        .from("solar_roof_planes")
        .insert(payload)
        .select("*")
        .single();
      if (insErr) throw new Error("Création du pan impossible.");
      kept.push(data);
    }
  }

  const obsolete = [...byKey.values()].map((r) => r.id);
  if (obsolete.length) {
    await sb.from("solar_roof_planes").delete().in("id", obsolete).eq("company_id", companyId);
  }
  return kept;
}

/* ------------------------------- Provenance ------------------------------- */

export interface ProvenanceInput {
  entity_kind: string;
  entity_id: string;
  attribute?: string;
  source_type: SourceType;
  source_provider?: string | null;
  source_dataset?: string | null;
  source_date?: string | null;
  source_ref?: string | null;
  confidence?: ConfidenceLevel;
  verification_status?: VerificationStatus;
  verification_method?: string | null;
  verified_at?: string | null;
  verified_by?: string | null;
  field_measurement_id?: string | null;
  metadata?: Record<string, unknown>;
}

/** Écrit (ou remplace) la provenance d'une donnée géométrique. */
export async function setProvenance(
  sb: SB,
  companyId: string,
  modelId: string,
  input: ProvenanceInput,
): Promise<void> {
  await sb.from("solar_provenance").upsert(
    {
      company_id: companyId,
      model_id: modelId,
      entity_kind: input.entity_kind,
      entity_id: input.entity_id,
      attribute: input.attribute ?? "geometry",
      source_type: input.source_type,
      source_provider: input.source_provider ?? null,
      source_dataset: input.source_dataset ?? null,
      source_date: input.source_date ?? null,
      source_ref: input.source_ref ?? null,
      confidence: input.confidence ?? defaultConfidence(input.source_type),
      verification_status: input.verification_status ?? "unverified",
      verification_method: input.verification_method ?? null,
      verified_at: input.verified_at ?? null,
      verified_by: input.verified_by ?? null,
      field_measurement_id: input.field_measurement_id ?? null,
      metadata: (input.metadata ?? {}) as never,
    },
    { onConflict: "model_id,entity_kind,entity_id,attribute" },
  );
}

/* ---------------------------- Version géométrique -------------------------- */

/**
 * Incrémente la version géométrique et recalcule l'empreinte.
 * Une analyse future sera toujours rattachable à une version précise.
 */
export async function bumpGeometryVersion(
  sb: SB,
  companyId: string,
  modelId: string,
  userId: string,
): Promise<{ version: number; hash: string }> {
  const model = await loadModelScoped(sb, companyId, modelId);
  const [buildings, planes, obstacles] = await Promise.all([
    sb.from("solar_buildings").select("*").eq("model_id", modelId).eq("company_id", companyId),
    sb.from("solar_roof_planes").select("*").eq("model_id", modelId).eq("company_id", companyId).order("name"),
    sb.from("solar_obstacles").select("*").eq("model_id", modelId).eq("company_id", companyId).order("created_at"),
  ]);

  const building = buildings.data?.[0] ?? null;
  const hash = geometryFingerprint({
    params: readBuildingParams(building),
    planes: (planes.data ?? []).map((p) => ({
      name: p.name,
      azimuth: p.azimuth_deg,
      tilt: p.tilt_deg,
      area: p.area_m2,
      polygon: p.polygon,
    })),
    obstacles: (obstacles.data ?? []).map((o) => ({
      t: o.obstacle_type,
      x: o.position_x_m,
      y: o.position_y_m,
      w: o.width_m,
      l: o.length_m,
      h: o.height_m,
    })),
    terrain: (building?.terrain as unknown) ?? null,
    origin: { lat: model.origin_latitude, lon: model.origin_longitude, alt: model.origin_altitude_m },
  });

  if (hash === model.geometry_hash) {
    return { version: model.geometry_version, hash };
  }

  const version = model.geometry_version + 1;
  await sb
    .from("solar_models")
    .update({ geometry_version: version, geometry_hash: hash, updated_by: userId })
    .eq("id", modelId)
    .eq("company_id", companyId);
  return { version, hash };
}

/* -------------------------------- Chargement ------------------------------- */

export interface SolarFullModel {
  model: SolarModelRow;
  building: SolarBuildingRow | null;
  params: BuildingParams;
  planes: (RoofPlaneGeometry & { id: string })[];
  edges: RoofEdge[];
  terrain: TerrainGrid | null;
  obstacles: Database["public"]["Tables"]["solar_obstacles"]["Row"][];
  arrays: Database["public"]["Tables"]["solar_arrays"]["Row"][];
  modules: PlacedModule[];
  catalog: Database["public"]["Tables"]["solar_module_catalog"]["Row"][];
  versions: {
    id: string;
    version_number: number;
    label: string;
    quality_level: string;
    created_at: string;
  }[];
  measurements: SolarMeasurementRow[];
  provenance: SolarProvenanceRow[];
  quality: ReturnType<typeof buildQualityReport>;
  coverage: unknown;
  summary: ReturnType<typeof computeSolarSummary>;
}

export async function loadFullModel(sb: SB, companyId: string, modelId: string): Promise<SolarFullModel> {
  const model = await loadModelScoped(sb, companyId, modelId);

  const [buildings, planes, obstacles, arrays, modules, catalog, versions, measurements, provenance] =
    await Promise.all([
      sb.from("solar_buildings").select("*").eq("model_id", modelId).eq("company_id", companyId),
      sb.from("solar_roof_planes").select("*").eq("model_id", modelId).eq("company_id", companyId).order("name"),
      sb.from("solar_obstacles").select("*").eq("model_id", modelId).eq("company_id", companyId).order("created_at"),
      sb.from("solar_arrays").select("*").eq("model_id", modelId).eq("company_id", companyId),
      sb.from("solar_modules_placed").select("*").eq("model_id", modelId).eq("company_id", companyId),
      sb
        .from("solar_module_catalog")
        .select("*")
        .or(`company_id.is.null,company_id.eq.${companyId}`)
        .eq("is_active", true)
        .order("power_wc", { ascending: false }),
      sb
        .from("solar_model_versions")
        .select("id, version_number, label, quality_level, created_at")
        .eq("model_id", modelId)
        .eq("company_id", companyId)
        .order("version_number", { ascending: false })
        .limit(20),
      sb
        .from("solar_measurements")
        .select("*")
        .eq("model_id", modelId)
        .eq("company_id", companyId)
        .order("created_at", { ascending: false }),
      sb.from("solar_provenance").select("*").eq("model_id", modelId).eq("company_id", companyId),
    ]);

  const building = buildings.data?.[0] ?? null;
  const params = readBuildingParams(building);
  const planeRows = planes.data ?? [];
  const geometry = planeRows
    .map((row) => ({ row, geo: planeGeometryFromRow(row) }))
    .filter((g): g is { row: SolarRoofPlaneRow; geo: RoofPlaneGeometry } => g.geo !== null);

  const placed: PlacedModule[] = (modules.data ?? []).map((m) => {
    const plane = geometry.find((g) => g.row.id === m.roof_plane_id);
    return {
      id: m.id,
      roof_plane_key: plane?.geo.key ?? "",
      grid_row: m.grid_row ?? 0,
      grid_col: m.grid_col ?? 0,
      local_u_m: m.local_u_m,
      local_v_m: m.local_v_m,
      orientation: m.orientation === "paysage" ? "paysage" : "portrait",
      enabled: m.enabled,
    };
  });

  const mainArray = (arrays.data ?? [])[0] ?? null;
  const spec = (catalog.data ?? []).find((c) => c.id === mainArray?.module_catalog_id) ?? null;
  const provenanceRows = provenance.data ?? [];
  const terrain = (building?.terrain as unknown as TerrainGrid | null) ?? null;

  return {
    model,
    building,
    params,
    planes: geometry.map((g) => ({ id: g.row.id, ...g.geo })),
    edges: deriveRoofEdges(geometry.map((g) => ({ id: g.row.id, ...g.geo }))),
    terrain,
    obstacles: obstacles.data ?? [],
    arrays: arrays.data ?? [],
    modules: placed,
    catalog: catalog.data ?? [],
    versions: versions.data ?? [],
    measurements: measurements.data ?? [],
    provenance: provenanceRows,
    quality: buildQualityReport(
      buildQualityRows({
        model,
        planes: geometry.map((g) => ({ id: g.row.id, ...g.geo })),
        obstacles: obstacles.data ?? [],
        measurements: measurements.data ?? [],
        provenance: provenanceRows,
        terrain,
      }),
    ),
    coverage: (model.settings as { coverage?: unknown } | null)?.coverage ?? null,
    summary: computeSolarSummary(
      geometry.map((g) => g.geo),
      placed,
      spec,
      (model.quality_level as SolarQualityLevel) ?? "pre_etude",
    ),
  };
}

/** Fiche « Qualité du modèle » : une ligne par élément, jamais un score unique. */
function buildQualityRows(input: {
  model: SolarModelRow;
  planes: (RoofPlaneGeometry & { id: string })[];
  obstacles: Database["public"]["Tables"]["solar_obstacles"]["Row"][];
  measurements: SolarMeasurementRow[];
  provenance: SolarProvenanceRow[];
  terrain: TerrainGrid | null;
}): QualityBreakdownRow[] {
  const find = (kind: string, id: string) =>
    input.provenance.find((p) => p.entity_kind === kind && p.entity_id === id) ?? null;

  const row = (
    label: string,
    prov: SolarProvenanceRow | null,
    fallbackSource: SourceType,
    detail: string,
  ): QualityBreakdownRow => {
    const source = (prov?.source_type as SourceType) ?? fallbackSource;
    const confidence = (prov?.confidence as ConfidenceLevel) ?? defaultConfidence(source);
    return {
      label,
      confidence: CONFIDENCE_META[confidence] ? confidence : "estimated",
      source,
      detail,
      verification: (prov?.verification_status as VerificationStatus) ?? "unverified",
    };
  };

  const rows: QualityBreakdownRow[] = [];

  rows.push(
    row(
      "Localisation",
      find("model", input.model.id),
      input.model.latitude == null ? "MANUAL" : "MAP",
      input.model.location_confirmed_at
        ? "Position confirmée par l'utilisateur."
        : input.model.latitude == null
          ? "Bâtiment non localisé."
          : "Position issue du géocodage, non confirmée.",
    ),
  );

  rows.push(
    row(
      "Terrain",
      null,
      input.terrain?.from_elevation_data ? "MNT" : "AUTO",
      input.terrain?.from_elevation_data
        ? "Altitudes issues du modèle numérique de terrain."
        : "Terrain plat par défaut : aucune donnée altimétrique importée.",
    ),
  );

  for (const plane of input.planes) {
    rows.push(
      row(
        plane.name,
        find("roof_plane", plane.id),
        "AUTO",
        `${plane.area_m2.toFixed(2)} m² · ${plane.tilt_deg.toFixed(1)}° · azimut ${plane.azimuth_deg.toFixed(1)}°`,
      ),
    );
  }

  for (const o of input.obstacles) {
    rows.push(
      row(
        o.label || o.obstacle_type,
        find("obstacle", o.id),
        (o.data_source === "manuel" ? "MANUAL" : "AUTO") as SourceType,
        `${o.width_m.toFixed(2)} × ${o.length_m.toFixed(2)} × ${o.height_m.toFixed(2)} m`,
      ),
    );
  }

  const verifiedDims = input.measurements.filter((m) => m.verification_status === "verified").length;
  if (input.measurements.length) {
    rows.push({
      label: "Cotes du projet",
      confidence: verifiedDims === input.measurements.length ? "field_verified" : "measured",
      source: verifiedDims ? "FIELD" : "MANUAL",
      detail: `${verifiedDims}/${input.measurements.length} vérifiées terrain`,
      verification: verifiedDims === input.measurements.length ? "verified" : "to_verify",
    });
  }

  return rows;
}

export async function refreshSummary(sb: SB, companyId: string, modelId: string, userId: string) {
  const full = await loadFullModel(sb, companyId, modelId);
  await sb
    .from("solar_models")
    .update({ summary: full.summary as never, updated_by: userId })
    .eq("id", modelId)
    .eq("company_id", companyId);
  return full;
}

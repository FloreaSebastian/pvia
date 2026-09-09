/**
 * Solar Studio — fonctions serveur de la phase 2 (géospatial, mesures, jobs).
 *
 * Règles :
 *  - aucun composant n'appelle un fournisseur externe : tout passe ici ;
 *  - une indisponibilité IGN n'empêche jamais l'édition manuelle ;
 *  - toute écriture géométrique met à jour provenance + version géométrique.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { writeAuditLog } from "./audit.server";
import {
  assertGeometryVersion,
  assertSolarManage,
  assertSolarMember,
  bumpGeometryVersion,
  loadFullModel,
  loadModelScoped,
  readBuildingParams,
  refreshSummary,
  setProvenance,
  syncRoofPlanes,
} from "./solar.server";
import { IgnGeoProvider } from "./solar/providers/ign.server";
import { PROVIDER_ERROR_MESSAGE, type CoverageStatus } from "./solar/providers/types";
import {
  AddressSearchSchema,
  ApplyProposalSchema,
  ConfirmLocationSchema,
  DimensionConstraintSchema,
  FieldMeasurementSchema,
  JobRefSchema,
  RevertGeometrySchema,
  SaveMeasurementSchema,
  SiteDataSchema,
  StartJobSchema,
} from "./solar/schemas";
import { makeOrigin, worldToLocal } from "./solar/crs";
import { buildTerrainGrid, DETAIL_ZONES, type ElevationSample } from "./solar/terrain";
import { proposeFromFootprint } from "./solar/footprint";
import type { BuildingParams } from "./solar/types";

/* --------------------------------- Adresse -------------------------------- */

export const searchSolarAddress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => AddressSearchSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertSolarMember(supabase, data.companyId, userId);
    const provider = new IgnGeoProvider(supabase);
    const res = await provider.search(data.query, 8);
    if (!res.ok) {
      return { ok: false as const, message: PROVIDER_ERROR_MESSAGE[res.error.code], candidates: [] };
    }
    return { ok: true as const, message: null, candidates: res.data };
  });

/** Confirme la position du bâtiment. Aucun résultat ambigu n'est retenu tout seul. */
export const confirmSolarLocation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => ConfirmLocationSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertSolarManage(supabase, data.companyId, userId);
    await loadModelScoped(supabase, data.companyId, data.modelId);

    const provider = new IgnGeoProvider(supabase);
    const elevation = await provider.sample([{ latitude: data.latitude, longitude: data.longitude }]);
    const altitude = elevation.ok ? (elevation.data[0]?.altitude_m ?? null) : null;
    const origin = makeOrigin({ latitude: data.latitude, longitude: data.longitude }, altitude);

    const { error } = await supabase
      .from("solar_models")
      .update({
        latitude: data.latitude,
        longitude: data.longitude,
        origin_latitude: data.latitude,
        origin_longitude: data.longitude,
        origin_altitude_m: altitude,
        altitude_source: altitude == null ? null : "IGN RGE ALTI",
        source_crs: "EPSG:4326",
        working_crs: origin.workingCrs,
        projected_crs: origin.workingCrs,
        geocode_source: "IGN Géoplateforme",
        location_confirmed_at: new Date().toISOString(),
        location_confirmed_by: userId,
        ...(data.address ? { address: data.address } : {}),
        ...(data.postal_code ? { postal_code: data.postal_code } : {}),
        ...(data.city ? { city: data.city } : {}),
        updated_by: userId,
      })
      .eq("id", data.modelId)
      .eq("company_id", data.companyId);
    if (error) throw new Error("Enregistrement de la localisation impossible.");

    await setProvenance(supabase, data.companyId, data.modelId, {
      entity_kind: "model",
      entity_id: data.modelId,
      attribute: "location",
      source_type: "MAP",
      source_provider: "IGN",
      source_dataset: "Base Adresse Nationale",
      confidence: "measured",
      verification_status: "verified",
      verification_method: "confirmation utilisateur",
      verified_at: new Date().toISOString(),
      verified_by: userId,
      metadata: { label: data.label, altitude_m: altitude },
    });

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      action: "solar_model.locate",
      entityType: "solar_model",
      entityId: data.modelId,
      metadata: { latitude: data.latitude, longitude: data.longitude },
    });

    return refreshSummary(supabase, data.companyId, data.modelId, userId);
  });

/* ----------------------------- Données du site ----------------------------- */

export const getSolarSiteData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => SiteDataSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertSolarMember(supabase, data.companyId, userId);
    const model = await loadModelScoped(supabase, data.companyId, data.modelId);

    if (model.origin_latitude == null || model.origin_longitude == null) {
      return {
        located: false as const,
        coverage: [] as CoverageStatus[],
        imagery: null,
        attribution: null,
        checked_at: null,
      };
    }

    const cached = (model.settings as { coverage?: { checked_at?: string; items?: CoverageStatus[] } } | null)
      ?.coverage;
    const fresh =
      cached?.checked_at && Date.now() - new Date(cached.checked_at).getTime() < 24 * 3600 * 1000 ? cached : null;

    const provider = new IgnGeoProvider(supabase);
    const point = { latitude: model.origin_latitude, longitude: model.origin_longitude };
    const coverage = !data.refresh && fresh?.items ? fresh.items : await provider.checkCoverage(point);
    const checked_at = !data.refresh && fresh?.checked_at ? fresh.checked_at : new Date().toISOString();

    if (data.refresh || !fresh) {
      const settings = (model.settings as Record<string, unknown> | null) ?? {};
      await supabase
        .from("solar_models")
        .update({ settings: { ...settings, coverage: { checked_at, items: coverage } } as never })
        .eq("id", data.modelId)
        .eq("company_id", data.companyId);
    }

    const plan = provider.getLayer("plan");
    const ortho = provider.getLayer("orthophoto");

    return {
      located: true as const,
      coverage,
      imagery: {
        plan: plan.ok ? plan.data : null,
        orthophoto: ortho.ok ? ortho.data : null,
      },
      attribution: provider.attribution,
      checked_at,
    };
  });

/* ---------------------------------- Jobs ---------------------------------- */

const JOB_STEPS: Record<string, string[]> = {
  FETCH_ELEVATION: ["Récupération des altitudes", "Contrôle de couverture", "Préparation des points", "Enregistrement"],
  GENERATE_TERRAIN: ["Récupération des données", "Analyse du terrain", "Maillage du terrain", "Préparation du modèle"],
  DETECT_ROOF: ["Récupération des données", "Analyse du bâtiment", "Détection des toitures", "Préparation du modèle"],
  FETCH_LIDAR: ["Recherche de la dalle", "Découpage", "Classification", "Préparation du modèle"],
  GENERATE_SURFACE: ["Récupération du MNS", "Soustraction du MNT", "Analyse", "Préparation du modèle"],
};

/**
 * Lance un traitement géospatial. Le job est idempotent : relancé sur une
 * géométrie inchangée avec les mêmes paramètres, il rend le résultat précédent
 * au lieu de retélécharger la donnée.
 */
export const startSolarJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => StartJobSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertSolarManage(supabase, data.companyId, userId);
    const model = await loadModelScoped(supabase, data.companyId, data.modelId);

    if (model.origin_latitude == null || model.origin_longitude == null) {
      throw new Error("Localisez d'abord le bâtiment : aucune donnée géographique n'est disponible sans position.");
    }

    const key = `${data.jobType}:${model.geometry_hash ?? "v" + model.geometry_version}`;
    if (!data.force) {
      const { data: existing } = await supabase
        .from("solar_processing_jobs")
        .select("*")
        .eq("model_id", data.modelId)
        .eq("company_id", data.companyId)
        .eq("idempotency_key", key)
        .maybeSingle();
      if (existing && existing.status === "COMPLETED") return existing;
    }

    const steps = JOB_STEPS[data.jobType] ?? ["Traitement"];
    const { data: job, error } = await supabase
      .from("solar_processing_jobs")
      .upsert(
        {
          company_id: data.companyId,
          model_id: data.modelId,
          job_type: data.jobType,
          idempotency_key: key,
          status: "PROCESSING",
          params: { origin: { lat: model.origin_latitude, lon: model.origin_longitude } } as never,
          result: {} as never,
          progress_step: 1,
          progress_total: steps.length,
          progress_label: steps[0]!,
          error_message: null,
          geometry_version: model.geometry_version,
          started_at: new Date().toISOString(),
          finished_at: null,
          created_by: userId,
        },
        { onConflict: "model_id,idempotency_key" },
      )
      .select("*")
      .single();
    if (error || !job) throw new Error("Impossible de lancer le traitement.");

    try {
      const result = await runJob(supabase, {
        companyId: data.companyId,
        modelId: data.modelId,
        userId,
        jobType: data.jobType,
        latitude: model.origin_latitude,
        longitude: model.origin_longitude,
        altitude: model.origin_altitude_m,
        params: readBuildingParams(
          (
            await supabase
              .from("solar_buildings")
              .select("*")
              .eq("model_id", data.modelId)
              .eq("company_id", data.companyId)
              .limit(1)
          ).data?.[0] ?? null,
        ),
      });

      const { data: done } = await supabase
        .from("solar_processing_jobs")
        .update({
          status: "COMPLETED",
          result: result as never,
          progress_step: steps.length,
          progress_label: steps[steps.length - 1]!,
          finished_at: new Date().toISOString(),
        })
        .eq("id", job.id)
        .eq("company_id", data.companyId)
        .select("*")
        .single();
      return done ?? job;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Traitement impossible.";
      const { data: failed } = await supabase
        .from("solar_processing_jobs")
        .update({
          status: "FAILED",
          error_message: message,
          finished_at: new Date().toISOString(),
        })
        .eq("id", job.id)
        .eq("company_id", data.companyId)
        .select("*")
        .single();
      return failed ?? job;
    }
  });

export const getSolarJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => JobRefSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertSolarMember(supabase, data.companyId, userId);
    const { data: job } = await supabase
      .from("solar_processing_jobs")
      .select("*")
      .eq("id", data.jobId)
      .eq("model_id", data.modelId)
      .eq("company_id", data.companyId)
      .maybeSingle();
    if (!job) throw new Error("Traitement introuvable.");
    return job;
  });

type SB = Parameters<typeof loadModelScoped>[0];

async function runJob(
  sb: SB,
  ctx: {
    companyId: string;
    modelId: string;
    userId: string;
    jobType: string;
    latitude: number;
    longitude: number;
    altitude: number | null;
    params: BuildingParams;
  },
): Promise<Record<string, unknown>> {
  const provider = new IgnGeoProvider(sb);
  const center = { latitude: ctx.latitude, longitude: ctx.longitude };

  if (ctx.jobType === "FETCH_LIDAR") {
    throw new Error(
      "LiDAR HD non connecté : le découpage des dalles brutes n'est pas réalisable depuis ce serveur. Aucune donnée simulée n'est produite.",
    );
  }
  if (ctx.jobType === "GENERATE_SURFACE") {
    throw new Error(
      "Modèle numérique de surface non connecté : nécessite un service de traitement raster externe. Aucune donnée simulée n'est produite.",
    );
  }

  if (ctx.jobType === "FETCH_ELEVATION" || ctx.jobType === "GENERATE_TERRAIN") {
    const zone = "near" as const;
    const { radius_m, grid_step_m } = DETAIL_ZONES[zone];
    const res = await provider.sampleGrid(center, radius_m, grid_step_m);
    if (!res.ok) throw new Error(PROVIDER_ERROR_MESSAGE[res.error.code]);
    if (!res.data.length) throw new Error("Aucune altitude disponible sur cette emprise.");

    const originAltitude =
      ctx.altitude ?? res.data.reduce((s, p) => s + p.altitude_m, 0) / res.data.length;
    const origin = makeOrigin(center, originAltitude);
    const samples: ElevationSample[] = res.data.map((p) => {
      const local = worldToLocal(origin, { latitude: p.latitude, longitude: p.longitude });
      return { x: local.x, y: local.y, z: p.altitude_m };
    });
    const grid = buildTerrainGrid(samples, { zone, originAltitude });

    if (ctx.jobType === "GENERATE_TERRAIN") {
      const { data: building } = await sb
        .from("solar_buildings")
        .select("id")
        .eq("model_id", ctx.modelId)
        .eq("company_id", ctx.companyId)
        .limit(1)
        .maybeSingle();
      if (building) {
        await sb
          .from("solar_buildings")
          .update({ terrain: grid as never })
          .eq("id", building.id)
          .eq("company_id", ctx.companyId);
        await setProvenance(sb, ctx.companyId, ctx.modelId, {
          entity_kind: "terrain",
          entity_id: building.id,
          attribute: "terrain",
          source_type: "MNT",
          source_provider: "IGN",
          source_dataset: "RGE ALTI",
          confidence: "derived_3d",
          metadata: { resolution_m: res.metadata.resolution_m, samples: samples.length },
        });
      }
      await sb
        .from("solar_models")
        .update({ origin_altitude_m: originAltitude, altitude_source: "IGN RGE ALTI" })
        .eq("id", ctx.modelId)
        .eq("company_id", ctx.companyId);
      await bumpGeometryVersion(sb, ctx.companyId, ctx.modelId, ctx.userId);
    }

    const min = Math.min(...grid.heights);
    const max = Math.max(...grid.heights);
    return {
      kind: ctx.jobType,
      samples: samples.length,
      origin_altitude_m: originAltitude,
      terrain_min_m: min,
      terrain_max_m: max,
      terrain_amplitude_m: max - min,
      dataset: res.metadata.dataset,
      provider: res.metadata.provider,
      resolution_m: res.metadata.resolution_m,
      attribution: res.metadata.attribution,
      applied: ctx.jobType === "GENERATE_TERRAIN",
    };
  }

  if (ctx.jobType === "DETECT_ROOF") {
    const res = await provider.findAt(center);
    if (!res.ok) throw new Error(PROVIDER_ERROR_MESSAGE[res.error.code]);
    if (!res.data.length) throw new Error("Aucune emprise de bâtiment disponible à cette adresse.");

    const origin = makeOrigin(center, ctx.altitude);
    const footprint = res.data[0]!;
    const ring = footprint.ring.map((p) => {
      const local = worldToLocal(origin, p);
      return { x: local.x, y: local.y };
    });
    const proposal = proposeFromFootprint(ring, {
      source_height_m: footprint.height_m,
      tilt_deg: ctx.params.tilt_deg,
    });
    if (!proposal) throw new Error("Contour de bâtiment inexploitable.");

    const proposed: BuildingParams = {
      ...ctx.params,
      width_m: Math.min(200, Math.max(1, proposal.width_m)),
      depth_m: Math.min(200, Math.max(1, proposal.depth_m)),
      azimuth_deg: proposal.azimuth_deg,
      wall_height_m:
        proposal.wall_height_m == null
          ? ctx.params.wall_height_m
          : Math.min(60, Math.max(0, proposal.wall_height_m)),
    };

    return {
      kind: "DETECT_ROOF",
      proposal: proposed,
      current: ctx.params,
      ring: proposal.ring,
      footprint_area_m2: proposal.footprint_area_m2,
      rectangularity: proposal.rectangularity,
      source_height_m: footprint.height_m,
      /* Confiance jamais surestimée : un contour cartographique n'est pas un relevé. */
      confidence: proposal.rectangularity > 0.92 ? "medium" : "low",
      provider: res.metadata.provider,
      dataset: res.metadata.dataset,
      attribution: res.metadata.attribution,
      applied: false,
    };
  }

  throw new Error("Type de traitement inconnu.");
}

/* ------------------------ Application d'une proposition -------------------- */

export const applySolarProposal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => ApplyProposalSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertSolarManage(supabase, data.companyId, userId);
    const model = await loadModelScoped(supabase, data.companyId, data.modelId);
    assertGeometryVersion(model, data.expectedGeometryVersion ?? null);

    const { data: job } = await supabase
      .from("solar_processing_jobs")
      .select("*")
      .eq("id", data.jobId)
      .eq("model_id", data.modelId)
      .eq("company_id", data.companyId)
      .maybeSingle();
    if (!job || job.status !== "COMPLETED") throw new Error("Aucun modèle proposé à appliquer.");

    const result = job.result as { proposal?: BuildingParams; provider?: string; dataset?: string } | null;
    const proposal = result?.proposal;
    if (!proposal) throw new Error("Ce traitement ne propose pas de géométrie.");

    const { data: buildings } = await supabase
      .from("solar_buildings")
      .select("*")
      .eq("model_id", data.modelId)
      .eq("company_id", data.companyId)
      .limit(1);
    const building = buildings?.[0] ?? null;
    if (!building) throw new Error("Bâtiment introuvable.");

    // Édition non destructive : la géométrie précédente est conservée.
    const previous = readBuildingParams(building);
    const { data: updated, error } = await supabase
      .from("solar_buildings")
      .update({
        roof_type: proposal.roof_type,
        wall_height_m: proposal.wall_height_m,
        rotation_deg: proposal.azimuth_deg,
        params: proposal as never,
        source_geometry: (building.source_geometry ?? { params: previous, saved_at: new Date().toISOString() }) as never,
        user_geometry: { params: previous, replaced_at: new Date().toISOString() } as never,
        data_source: "automatique",
      })
      .eq("id", building.id)
      .eq("company_id", data.companyId)
      .select("*")
      .single();
    if (error || !updated) throw new Error("Application du modèle impossible.");

    const planes = await syncRoofPlanes(supabase, data.companyId, data.modelId, updated, proposal);
    for (const plane of planes) {
      await setProvenance(supabase, data.companyId, data.modelId, {
        entity_kind: "roof_plane",
        entity_id: plane.id,
        source_type: "MAP",
        source_provider: result?.provider ?? "IGN",
        source_dataset: result?.dataset ?? "BD TOPO — bâtiment",
        confidence: "estimated",
        verification_status: "to_verify",
      });
    }
    await setProvenance(supabase, data.companyId, data.modelId, {
      entity_kind: "building",
      entity_id: updated.id,
      source_type: "MAP",
      source_provider: result?.provider ?? "IGN",
      source_dataset: result?.dataset ?? "BD TOPO — bâtiment",
      confidence: "estimated",
      verification_status: "to_verify",
    });

    await supabase
      .from("solar_processing_jobs")
      .update({ result: { ...(job.result as object), applied: true } as never })
      .eq("id", job.id)
      .eq("company_id", data.companyId);

    await bumpGeometryVersion(supabase, data.companyId, data.modelId, userId);
    await writeAuditLog({
      companyId: data.companyId,
      userId,
      action: "solar_model.apply_proposal",
      entityType: "solar_model",
      entityId: data.modelId,
      metadata: { job_type: job.job_type },
    });

    return refreshSummary(supabase, data.companyId, data.modelId, userId);
  });

/** Revient à la géométrie source conservée. Les corrections ne sont jamais perdues sans avertissement. */
export const revertSolarGeometry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => RevertGeometrySchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertSolarManage(supabase, data.companyId, userId);
    await loadModelScoped(supabase, data.companyId, data.modelId);

    const { data: buildings } = await supabase
      .from("solar_buildings")
      .select("*")
      .eq("model_id", data.modelId)
      .eq("company_id", data.companyId)
      .limit(1);
    const building = buildings?.[0] ?? null;
    if (!building) throw new Error("Bâtiment introuvable.");
    const source = building.source_geometry as { params?: BuildingParams } | null;
    if (!source?.params) throw new Error("Aucune géométrie source conservée pour ce bâtiment.");

    const current = readBuildingParams(building);
    const params = source.params;
    const { data: updated, error } = await supabase
      .from("solar_buildings")
      .update({
        roof_type: params.roof_type,
        wall_height_m: params.wall_height_m,
        rotation_deg: params.azimuth_deg,
        params: params as never,
        user_geometry: { params: current, replaced_at: new Date().toISOString() } as never,
      })
      .eq("id", building.id)
      .eq("company_id", data.companyId)
      .select("*")
      .single();
    if (error || !updated) throw new Error("Restauration impossible.");

    await syncRoofPlanes(supabase, data.companyId, data.modelId, updated, params);
    await bumpGeometryVersion(supabase, data.companyId, data.modelId, userId);
    return refreshSummary(supabase, data.companyId, data.modelId, userId);
  });

/* --------------------------------- Mesures -------------------------------- */

export const saveSolarMeasurement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => SaveMeasurementSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertSolarManage(supabase, data.companyId, userId);
    const model = await loadModelScoped(supabase, data.companyId, data.modelId);

    const payload = {
      company_id: data.companyId,
      model_id: data.modelId,
      measure_type: data.measure_type,
      category: data.category,
      label: data.label,
      value_numeric: data.value_numeric,
      value_estimated: data.value_numeric,
      value_retained: data.value_numeric,
      retained_origin: "estimated",
      unit: data.unit,
      pinned: data.pinned,
      target_kind: data.target_kind ?? null,
      target_id: data.target_id ?? null,
      geometry: { points: data.geometry } as never,
      data_source: data.data_source,
      geometry_version: model.geometry_version,
      created_by: userId,
    };

    let measurementId = data.measurementId ?? null;
    if (measurementId) {
      const { error } = await supabase
        .from("solar_measurements")
        .update({
          label: data.label,
          category: data.category,
          pinned: data.pinned,
        })
        .eq("id", measurementId)
        .eq("model_id", data.modelId)
        .eq("company_id", data.companyId);
      if (error) throw new Error("Enregistrement de la cote impossible.");
    } else {
      const { data: created, error } = await supabase.from("solar_measurements").insert(payload).select("id").single();
      if (error || !created) throw new Error("Enregistrement de la cote impossible.");
      measurementId = created.id;
    }

    await setProvenance(supabase, data.companyId, data.modelId, {
      entity_kind: "measurement",
      entity_id: measurementId,
      source_type: data.data_source,
      source_provider: "PVIA",
      source_dataset: "Mesure Solar Studio",
    });

    return refreshSummary(supabase, data.companyId, data.modelId, userId);
  });

export const deleteSolarMeasurement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ companyId: z.string().uuid(), modelId: z.string().uuid(), measurementId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertSolarManage(supabase, data.companyId, userId);
    const { error } = await supabase
      .from("solar_measurements")
      .delete()
      .eq("id", data.measurementId)
      .eq("model_id", data.modelId)
      .eq("company_id", data.companyId);
    if (error) throw new Error("Suppression impossible.");
    return refreshSummary(supabase, data.companyId, data.modelId, userId);
  });

/**
 * Enregistre une mesure terrain sur une cote existante.
 * L'estimation d'origine est CONSERVÉE : seule la valeur retenue change.
 */
export const recordFieldMeasurement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => FieldMeasurementSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertSolarManage(supabase, data.companyId, userId);
    await loadModelScoped(supabase, data.companyId, data.modelId);

    const { data: row } = await supabase
      .from("solar_measurements")
      .select("*")
      .eq("id", data.measurementId)
      .eq("model_id", data.modelId)
      .eq("company_id", data.companyId)
      .maybeSingle();
    if (!row) throw new Error("Cote introuvable.");

    const now = new Date().toISOString();
    const { error } = await supabase
      .from("solar_measurements")
      .update({
        value_field: data.value_field,
        value_estimated: row.value_estimated ?? row.value_numeric,
        value_retained: data.retain ? data.value_field : (row.value_retained ?? row.value_numeric),
        retained_origin: data.retain ? "field" : (row.retained_origin ?? "estimated"),
        verification_status: "verified",
        verification_method: data.verification_method,
        verified_at: now,
        verified_by: userId,
      })
      .eq("id", data.measurementId)
      .eq("company_id", data.companyId);
    if (error) throw new Error("Enregistrement de la mesure terrain impossible.");

    await setProvenance(supabase, data.companyId, data.modelId, {
      entity_kind: "measurement",
      entity_id: data.measurementId,
      source_type: "FIELD",
      source_provider: "PVIA",
      source_dataset: "Relevé terrain",
      confidence: "field_verified",
      verification_status: "verified",
      verification_method: data.verification_method,
      verified_at: now,
      verified_by: userId,
      field_measurement_id: data.measurementId,
    });

    return refreshSummary(supabase, data.companyId, data.modelId, userId);
  });

/**
 * Surcontrainte géométrique : une mesure terrain corrige une dimension.
 * L'aperçu est calculé côté client AVANT appel ; ici on applique et on trace.
 */
export const applyDimensionConstraint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => DimensionConstraintSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertSolarManage(supabase, data.companyId, userId);
    const model = await loadModelScoped(supabase, data.companyId, data.modelId);
    assertGeometryVersion(model, data.expectedGeometryVersion ?? null);

    const { data: buildings } = await supabase
      .from("solar_buildings")
      .select("*")
      .eq("model_id", data.modelId)
      .eq("company_id", data.companyId)
      .limit(1);
    const building = buildings?.[0] ?? null;
    if (!building) throw new Error("Bâtiment introuvable.");

    const current = readBuildingParams(building);
    const next: BuildingParams = { ...current, [data.target]: data.value } as BuildingParams;

    const { data: updated, error } = await supabase
      .from("solar_buildings")
      .update({
        roof_type: next.roof_type,
        wall_height_m: next.wall_height_m,
        rotation_deg: next.azimuth_deg,
        params: next as never,
        source_geometry: (building.source_geometry ?? { params: current, saved_at: new Date().toISOString() }) as never,
        data_source: "mesure_manuelle",
      })
      .eq("id", building.id)
      .eq("company_id", data.companyId)
      .select("*")
      .single();
    if (error || !updated) throw new Error("Correction impossible.");

    await syncRoofPlanes(supabase, data.companyId, data.modelId, updated, next);
    await setProvenance(supabase, data.companyId, data.modelId, {
      entity_kind: "building",
      entity_id: updated.id,
      attribute: data.target,
      source_type: "FIELD",
      source_provider: "PVIA",
      source_dataset: "Mesure terrain",
      confidence: "field_verified",
      verification_status: "verified",
      verification_method: "surcontrainte géométrique",
      verified_at: new Date().toISOString(),
      verified_by: userId,
      field_measurement_id: data.measurementId ?? null,
      metadata: { before: current[data.target], after: data.value },
    });

    await bumpGeometryVersion(supabase, data.companyId, data.modelId, userId);
    await writeAuditLog({
      companyId: data.companyId,
      userId,
      action: "solar_model.dimension_constraint",
      entityType: "solar_model",
      entityId: data.modelId,
      metadata: { target: data.target, before: current[data.target], after: data.value },
    });

    return refreshSummary(supabase, data.companyId, data.modelId, userId);
  });

/* -------------------------------- Historique ------------------------------- */

export const getSolarHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ companyId: z.string().uuid(), modelId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertSolarMember(supabase, data.companyId, userId);
    await loadModelScoped(supabase, data.companyId, data.modelId);
    const { data: rows } = await supabase
      .from("audit_logs")
      .select("id, action, created_at, user_id, metadata")
      .eq("company_id", data.companyId)
      .eq("entity_id", data.modelId)
      .order("created_at", { ascending: false })
      .limit(50);
    return rows ?? [];
  });

export const reloadSolarModel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid(), modelId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertSolarMember(supabase, data.companyId, userId);
    return loadFullModel(supabase, data.companyId, data.modelId);
  });

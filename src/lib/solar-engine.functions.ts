/**
 * Solar Studio — phase 2B : pilotage du moteur géospatial externe.
 *
 * Flux imposé : utilisateur authentifié → fonction serveur PVIA → contrôle des
 * droits et de l'entreprise → création du job → worker. Le navigateur ne parle
 * jamais au moteur, et le worker ne choisit jamais le tenant.
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
  planeGeometryFromRow,
  refreshSummary,
  setProvenance,
} from "./solar.server";
import { getEngineStatus, isEngineConfigured } from "./solar/engine.server";
import { compareWithEngine, enginePlaneToGeometry, isEngineRoofModel, type EngineRoofModel } from "./solar/engine";
import { revalidateModules, revalidationMessage } from "./solar/diff";
import { fingerprint } from "./solar/hash";

const ANALYSIS_JOB = "ANALYZE_BUILDING_3D";
/** Un utilisateur ne lance pas dix analyses en parallèle sur une entreprise. */
const MAX_ACTIVE_JOBS_PER_COMPANY = 2;

const ModelRef = z.object({
  companyId: z.string().uuid(),
  modelId: z.string().uuid(),
});

const StartAnalysisSchema = ModelRef.extend({
  environment_radius_m: z.number().min(10).max(120).default(40),
  include_point_cloud: z.boolean().default(false),
  force: z.boolean().default(false),
});

const JobRef = ModelRef.extend({ jobId: z.string().uuid() });

const ApplySchema = JobRef.extend({
  expectedGeometryVersion: z.number().int().min(1).nullable().optional(),
});

/* ------------------------------- État moteur ------------------------------- */

export const getSolarEngineStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => ModelRef.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertSolarMember(supabase, data.companyId, userId);

    const status = await getEngineStatus();
    const { data: jobs } = await supabase
      .from("solar_processing_jobs")
      .select("*")
      .eq("company_id", data.companyId)
      .eq("model_id", data.modelId)
      .eq("job_type", ANALYSIS_JOB)
      .order("created_at", { ascending: false })
      .limit(5);

    return { engine: status, jobs: jobs ?? [] };
  });

/* ------------------------------ Lancement job ------------------------------ */

export const startBuilding3dAnalysis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => StartAnalysisSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertSolarManage(supabase, data.companyId, userId);
    const model = await loadModelScoped(supabase, data.companyId, data.modelId);

    if (!isEngineConfigured()) {
      throw new Error(
        "Service de traitement 3D non configuré : l'analyse LiDAR n'est pas disponible sur cette installation.",
      );
    }
    if (model.origin_latitude == null || model.origin_longitude == null) {
      throw new Error("Localisez d'abord le bâtiment : aucune analyse 3D n'est possible sans position confirmée.");
    }

    const { count } = await supabase
      .from("solar_processing_jobs")
      .select("id", { count: "exact", head: true })
      .eq("company_id", data.companyId)
      .in("status", ["QUEUED", "CLAIMED", "PROCESSING"]);
    if ((count ?? 0) >= MAX_ACTIVE_JOBS_PER_COMPANY) {
      throw new Error("Deux analyses 3D sont déjà en cours pour votre entreprise. Attendez leur fin.");
    }

    const params = {
      latitude: model.origin_latitude,
      longitude: model.origin_longitude,
      altitude_m: model.origin_altitude_m,
      environment_radius_m: data.environment_radius_m,
      include_point_cloud: data.include_point_cloud,
      footprint: [] as number[][],
    };
    // Empreinte d'entrée : même zone + mêmes paramètres = même résultat réutilisable.
    const inputHash = fingerprint({
      job: ANALYSIS_JOB,
      lat: Math.round(model.origin_latitude * 1e6),
      lon: Math.round(model.origin_longitude * 1e6),
      radius: data.environment_radius_m,
      cloud: data.include_point_cloud,
      geometry_version: model.geometry_version,
    });

    if (!data.force) {
      const { data: existing } = await supabase
        .from("solar_processing_jobs")
        .select("*")
        .eq("company_id", data.companyId)
        .eq("model_id", data.modelId)
        .eq("input_hash", inputHash)
        .in("status", ["QUEUED", "CLAIMED", "PROCESSING", "COMPLETED"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existing) return existing;
    }

    const { data: job, error } = await supabase
      .from("solar_processing_jobs")
      .upsert(
        {
          company_id: data.companyId,
          model_id: data.modelId,
          job_type: ANALYSIS_JOB,
          idempotency_key: `${ANALYSIS_JOB}:${inputHash}${data.force ? `:${Date.now()}` : ""}`,
          input_hash: inputHash,
          status: "QUEUED",
          params: params as never,
          result: {} as never,
          progress_step: 0,
          progress_total: 6,
          progress_percent: 0,
          progress_label: "En attente d'un moteur de traitement",
          stage: "QUEUED",
          error_message: null,
          error_code: null,
          geometry_version: model.geometry_version,
          created_by: userId,
        },
        { onConflict: "model_id,idempotency_key" },
      )
      .select("*")
      .single();
    if (error || !job) throw new Error("Impossible de lancer l'analyse 3D.");

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      action: "solar_model.analysis_3d_requested",
      entityType: "solar_model",
      entityId: data.modelId,
      metadata: { job_id: job.id, radius_m: data.environment_radius_m },
    });
    return job;
  });

export const cancelSolar3dAnalysis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => JobRef.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertSolarManage(supabase, data.companyId, userId);

    const { data: job } = await supabase
      .from("solar_processing_jobs")
      .select("*")
      .eq("id", data.jobId)
      .eq("company_id", data.companyId)
      .eq("model_id", data.modelId)
      .maybeSingle();
    if (!job) throw new Error("Traitement introuvable.");

    // En attente : annulation immédiate. En cours : demande transmise au worker,
    // le statut ne passe à « annulé » que lorsqu'il l'a réellement pris en compte.
    if (job.status === "QUEUED") {
      const { data: updated } = await supabase
        .from("solar_processing_jobs")
        .update({
          status: "CANCELLED",
          cancel_requested_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
        })
        .eq("id", job.id)
        .eq("company_id", data.companyId)
        .select("*")
        .single();
      return { job: updated ?? job, immediate: true as const };
    }

    const { data: updated } = await supabase
      .from("solar_processing_jobs")
      .update({ cancel_requested_at: new Date().toISOString() })
      .eq("id", job.id)
      .eq("company_id", data.companyId)
      .select("*")
      .single();
    return { job: updated ?? job, immediate: false as const };
  });

/* ------------------------- Proposition et comparaison ---------------------- */

export const getSolar3dProposal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => JobRef.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertSolarMember(supabase, data.companyId, userId);

    const { data: job } = await supabase
      .from("solar_processing_jobs")
      .select("*")
      .eq("id", data.jobId)
      .eq("company_id", data.companyId)
      .eq("model_id", data.modelId)
      .maybeSingle();
    if (!job) throw new Error("Traitement introuvable.");

    const model = job.status === "COMPLETED" ? (job.result as unknown) : null;
    if (!isEngineRoofModel(model)) {
      return { job, proposal: null, diff: [], applied: false as const };
    }

    const full = await loadFullModel(supabase, data.companyId, data.modelId);
    const totalArea = full.planes.reduce((s, p) => s + p.area_m2, 0);
    const main = [...full.planes].sort((a, b) => b.area_m2 - a.area_m2)[0] ?? null;
    const diff = compareWithEngine(
      {
        plane_count: full.planes.length,
        total_area_m2: totalArea,
        main_tilt_deg: main?.tilt_deg ?? null,
        main_azimuth_deg: main?.azimuth_deg ?? null,
        ridge_height_m: full.planes.length ? Math.max(...full.planes.map((p) => p.ridge_height_m ?? 0)) : null,
      },
      model,
    );

    const { data: stored } = await supabase
      .from("solar_engine_results")
      .select("id, applied_at")
      .eq("job_id", job.id)
      .eq("company_id", data.companyId)
      .maybeSingle();

    return { job, proposal: model, diff, applied: !!stored?.applied_at };
  });

/* ------------------------ Application non destructive ---------------------- */

export const applySolar3dProposal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => ApplySchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertSolarManage(supabase, data.companyId, userId);
    const model = await loadModelScoped(supabase, data.companyId, data.modelId);
    assertGeometryVersion(model, data.expectedGeometryVersion ?? null);

    const { data: job } = await supabase
      .from("solar_processing_jobs")
      .select("*")
      .eq("id", data.jobId)
      .eq("company_id", data.companyId)
      .eq("model_id", data.modelId)
      .maybeSingle();
    if (!job || job.status !== "COMPLETED") throw new Error("Aucune proposition 3D à appliquer.");

    const proposal = job.result as unknown;
    if (!isEngineRoofModel(proposal)) throw new Error("Résultat 3D illisible : proposition non appliquée.");

    const full = await loadFullModel(supabase, data.companyId, data.modelId);
    const { data: buildings } = await supabase
      .from("solar_buildings")
      .select("*")
      .eq("model_id", data.modelId)
      .eq("company_id", data.companyId)
      .limit(1);
    const building = buildings?.[0] ?? null;
    if (!building) throw new Error("Bâtiment introuvable.");

    // 1) Version conservée AVANT modification : l'ancien modèle reste disponible.
    const { data: last } = await supabase
      .from("solar_model_versions")
      .select("version_number")
      .eq("model_id", data.modelId)
      .eq("company_id", data.companyId)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    await supabase.from("solar_model_versions").insert({
      company_id: data.companyId,
      model_id: data.modelId,
      version_number: (last?.version_number ?? 0) + 1,
      label: "Avant application du modèle 3D",
      quality_level: full.model.quality_level,
      snapshot: {
        params: full.params,
        planes: full.planes,
        obstacles: full.obstacles,
        arrays: full.arrays,
        modules: full.modules,
        summary: full.summary,
      } as never,
      created_by: userId,
    });

    // 2) Remplacement des pans par la géométrie dérivée des données 3D.
    const geometries = proposal.planes
      .map((p) => ({ plane: p, geometry: enginePlaneToGeometry(p) }))
      .filter((g): g is { plane: (typeof proposal.planes)[number]; geometry: NonNullable<typeof g.geometry> } =>
        Boolean(g.geometry),
      );
    if (!geometries.length) throw new Error("La proposition ne contient aucun pan exploitable.");

    const source = proposal.sources[0] ?? null;
    await supabase
      .from("solar_roof_planes")
      .delete()
      .eq("model_id", data.modelId)
      .eq("company_id", data.companyId);

    const inserted: { id: string; key: string }[] = [];
    for (const { plane, geometry } of geometries) {
      const { data: row, error } = await supabase
        .from("solar_roof_planes")
        .insert({
          company_id: data.companyId,
          model_id: data.modelId,
          building_id: building.id,
          name: geometry.name,
          azimuth_deg: geometry.azimuth_deg,
          tilt_deg: geometry.tilt_deg,
          area_m2: geometry.area_m2,
          eave_height_m: geometry.eave_height_m,
          ridge_height_m: geometry.ridge_height_m,
          polygon: { key: geometry.key, points: geometry.polygon, frame: geometry.frame } as never,
          data_source: "lidar",
          source_ref: source ? `${source.provider} — ${source.dataset}` : "LiDAR",
          source_date: source?.acquisition_date ?? null,
          verification_status: "to_verify",
          detection: {
            point_count: plane.point_count,
            rejected_points: plane.rejected_points,
            density_pts_m2: plane.density_pts_m2,
            rmse_m: plane.rmse_m,
            max_error_m: plane.max_error_m,
            dispersion_m: plane.dispersion_m,
            confidence: plane.confidence,
            confidence_reasons: plane.confidence_reasons,
            algorithm: proposal.pipeline_version,
            engine_version: proposal.engine_version,
          } as never,
        })
        .select("id")
        .single();
      if (error || !row) throw new Error("Création des pans détectés impossible.");
      inserted.push({ id: row.id, key: geometry.key });

      await setProvenance(supabase, data.companyId, data.modelId, {
        entity_kind: "roof_plane",
        entity_id: row.id,
        attribute: "geometry",
        source_type: "LIDAR",
        source_provider: source?.provider ?? "IGN",
        source_dataset: source?.dataset ?? "LiDAR HD",
        confidence: "derived_3d",
        verification_status: "to_verify",
        metadata: {
          points: plane.point_count,
          rmse_m: plane.rmse_m,
          pipeline: proposal.pipeline_version,
        },
      });
    }

    // 3) Bâtiment : géométrie source conservée, terrain repris si disponible.
    await supabase
      .from("solar_buildings")
      .update({
        source_geometry: (building.source_geometry ??
          { params: full.params, saved_at: new Date().toISOString() }) as never,
        user_geometry: { params: full.params, replaced_at: new Date().toISOString() } as never,
        data_source: "lidar",
        ...(proposal.terrain.available && proposal.terrain.heights?.length
          ? {
              terrain: {
                zone: "near",
                cols: proposal.terrain.cols,
                rows: proposal.terrain.rows,
                grid_step_m: proposal.terrain.grid_step_m,
                heights: proposal.terrain.heights,
                origin_altitude_m: proposal.terrain.origin_altitude_m,
                source: "LiDAR HD / MNT",
              } as never,
            }
          : {}),
      })
      .eq("id", building.id)
      .eq("company_id", data.companyId);

    // 4) Panneaux : reprojetés puis vérifiés. Jamais supprimés automatiquement.
    const revalidation = revalidateModules(
      geometries.map(({ geometry }) => ({ key: geometry.key, polygon: geometry.polygon })),
      full.modules,
    );

    await supabase
      .from("solar_engine_results")
      .update({ applied_at: new Date().toISOString(), applied_by: userId })
      .eq("job_id", job.id)
      .eq("company_id", data.companyId);

    await bumpGeometryVersion(supabase, data.companyId, data.modelId, userId);
    await writeAuditLog({
      companyId: data.companyId,
      userId,
      action: "solar_model.apply_3d_model",
      entityType: "solar_model",
      entityId: data.modelId,
      metadata: {
        job_id: job.id,
        planes: inserted.length,
        invalid_modules: revalidation.invalid_count,
        pipeline: proposal.pipeline_version,
      },
    });

    const refreshed = await refreshSummary(supabase, data.companyId, data.modelId, userId);
    return {
      model: refreshed,
      planes_created: inserted.length,
      modules_to_reposition: revalidation.invalid_count,
      modules_message: revalidationMessage(revalidation),
      invalid_module_ids: revalidation.invalid_ids,
    };
  });

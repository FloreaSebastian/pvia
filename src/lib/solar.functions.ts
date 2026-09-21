/**
 * Solar Studio — fonctions serveur.
 *
 * Règles structurantes :
 *  - la géométrie est TOUJOURS recalculée côté serveur par les modules purs
 *    (src/lib/solar/*), jamais reprise telle quelle depuis le navigateur ;
 *  - toute écriture exige un rôle de gestion ET une entreprise en droit d'écrire ;
 *  - le modèle appartient au dossier : il est conservé et enrichi, jamais recréé.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { writeAuditLog } from "./audit.server";
import {
  assertGeometryVersion,
  assertSolarManage,
  assertSolarMember,
  bumpGeometryVersion,
  loadFullModel,
  loadModelScoped,
  planeGeometryFromRow,
  readBuildingParams,
  refreshSummary,
  setProvenance,
  syncRoofPlanes,
  type SolarFullModel,
} from "./solar.server";
import {
  LayoutRequestSchema,
  ModelMetaSchema,
  ObstacleInputSchema,
  SaveBuildingSchema,
  ToggleModuleSchema,
  VersionSchema,
} from "./solar/schemas";
import { gridLayout, type PlaneObstacle } from "./solar/layout";
import {
  customPlanesFromGeometry,
  planeFromCustom,
  validateRoofRing,
  type CustomRoofPlane,
} from "./solar/polygon";
import { DEFAULT_BUILDING_PARAMS, SOLAR_SCHEMA_VERSION } from "./solar/types";

const ModelRefSchema = z.object({
  companyId: z.string().uuid(),
  studyId: z.string().uuid(),
});

export type SolarModelPayload = SolarFullModel;

/** Charge le modèle d'un cahier des charges. Retourne null s'il n'existe pas encore. */
export const getSolarModel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => ModelRefSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertSolarMember(supabase, data.companyId, userId);
    const { data: model } = await supabase
      .from("solar_models")
      .select("id")
      .eq("company_id", data.companyId)
      .eq("study_id", data.studyId)
      .maybeSingle();
    if (!model) return null;
    return loadFullModel(supabase, data.companyId, model.id);
  });

/* -------------------------------- Création -------------------------------- */

export const createSolarModel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => ModelRefSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertSolarManage(supabase, data.companyId, userId);

    const { data: study, error: studyErr } = await supabase
      .from("technical_studies")
      .select("id, company_id, study_type, site_address, site_postal_code, site_city, reference")
      .eq("id", data.studyId)
      .eq("company_id", data.companyId)
      .maybeSingle();
    if (studyErr || !study) throw new Error("Cahier des charges introuvable.");
    if (study.study_type !== "photovoltaique") {
      throw new Error("La modélisation 3D est réservée aux cahiers des charges photovoltaïques.");
    }

    const { data: existing } = await supabase
      .from("solar_models")
      .select("id")
      .eq("company_id", data.companyId)
      .eq("study_id", data.studyId)
      .maybeSingle();
    if (existing) return loadFullModel(supabase, data.companyId, existing.id);

    // Géocodage du site (BAN, service public français) : sert d'origine du repère local.
    const geo = await geocode(
      [study.site_address, study.site_postal_code, study.site_city]
        .filter(Boolean)
        .join(" ")
        .trim(),
    );

    const { data: model, error } = await supabase
      .from("solar_models")
      .insert({
        company_id: data.companyId,
        study_id: data.studyId,
        name: `Modélisation ${study.reference ?? ""}`.trim(),
        status: "active",
        quality_level: "pre_etude",
        address: study.site_address ?? "",
        postal_code: study.site_postal_code ?? "",
        city: study.site_city ?? "",
        latitude: geo?.latitude ?? null,
        longitude: geo?.longitude ?? null,
        origin_latitude: geo?.latitude ?? null,
        origin_longitude: geo?.longitude ?? null,
        geocode_source: geo ? "api-adresse.data.gouv.fr" : null,
        geocode_score: geo?.score ?? null,
        schema_version: SOLAR_SCHEMA_VERSION,
        created_by: userId,
        updated_by: userId,
      })
      .select("*")
      .single();
    if (error) throw new Error("Création du modèle impossible.");

    const { data: building, error: bErr } = await supabase
      .from("solar_buildings")
      .insert({
        company_id: data.companyId,
        model_id: model.id,
        name: "Bâtiment principal",
        roof_type: DEFAULT_BUILDING_PARAMS.roof_type,
        wall_height_m: DEFAULT_BUILDING_PARAMS.wall_height_m,
        rotation_deg: DEFAULT_BUILDING_PARAMS.azimuth_deg,
        params: DEFAULT_BUILDING_PARAMS as never,
        data_source: "manuel",
      })
      .select("*")
      .single();
    if (bErr) throw new Error("Création du bâtiment impossible.");

    await syncRoofPlanes(supabase, data.companyId, model.id, building, DEFAULT_BUILDING_PARAMS);

    if (geo) {
      await supabase.from("solar_data_sources").insert({
        company_id: data.companyId,
        model_id: model.id,
        provider: "IGN / DINUM",
        dataset: "Base Adresse Nationale",
        api_version: "api-adresse.data.gouv.fr",
        license: "Licence Ouverte / Etalab 2.0",
        attribution: "© Base Adresse Nationale",
        payload: { score: geo.score, label: geo.label } as never,
      });
    }

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      action: "solar_model.create",
      entityType: "solar_model",
      entityId: model.id,
      metadata: { study_id: data.studyId },
    });

    return refreshSummary(supabase, data.companyId, model.id, userId);
  });

async function geocode(
  query: string,
): Promise<{ latitude: number; longitude: number; score: number; label: string } | null> {
  if (query.length < 5) return null;
  try {
    const url = new URL("https://api-adresse.data.gouv.fr/search/");
    url.searchParams.set("q", query);
    url.searchParams.set("limit", "1");
    const res = await fetch(url.toString(), { headers: { "User-Agent": "PVIA-SolarStudio/1.0" } });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      features?: {
        geometry?: { coordinates?: [number, number] };
        properties?: { score?: number; label?: string };
      }[];
    };
    const f = json.features?.[0];
    const c = f?.geometry?.coordinates;
    if (!Array.isArray(c) || c.length < 2) return null;
    return {
      longitude: c[0]!,
      latitude: c[1]!,
      score: f?.properties?.score ?? 0,
      label: f?.properties?.label ?? query,
    };
  } catch {
    return null;
  }
}

/* -------------------------------- Bâtiment -------------------------------- */

export const saveSolarBuilding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => SaveBuildingSchema.parse(i))
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
    let building = buildings?.[0] ?? null;

    const payload = {
      company_id: data.companyId,
      model_id: data.modelId,
      name: data.name ?? building?.name ?? "Bâtiment principal",
      roof_type: data.params.roof_type,
      wall_height_m: data.params.wall_height_m,
      rotation_deg: data.params.azimuth_deg,
      params: data.params as never,
      data_source: "manuel",
    };

    if (building) {
      const { data: updated, error } = await supabase
        .from("solar_buildings")
        .update(payload)
        .eq("id", building.id)
        .eq("company_id", data.companyId)
        .select("*")
        .single();
      if (error) throw new Error("Enregistrement du bâtiment impossible.");
      building = updated;
    } else {
      const { data: created, error } = await supabase
        .from("solar_buildings")
        .insert(payload)
        .select("*")
        .single();
      if (error) throw new Error("Enregistrement du bâtiment impossible.");
      building = created;
    }

    const planes = await syncRoofPlanes(
      supabase,
      data.companyId,
      data.modelId,
      building,
      data.params,
    );

    // Provenance : saisie manuelle du bâtiment et des pans qui en découlent.
    await setProvenance(supabase, data.companyId, data.modelId, {
      entity_kind: "building",
      entity_id: building.id,
      source_type: "MANUAL",
      source_provider: "PVIA",
      source_dataset: "Saisie Solar Studio",
    });
    for (const plane of planes) {
      await setProvenance(supabase, data.companyId, data.modelId, {
        entity_kind: "roof_plane",
        entity_id: plane.id,
        source_type: "AUTO",
        source_provider: "PVIA",
        source_dataset: "Toiture paramétrique",
      });
    }

    await bumpGeometryVersion(supabase, data.companyId, data.modelId, userId);
    return refreshSummary(supabase, data.companyId, data.modelId, userId);
  });

/* ------------------------- Pans dessinés (P0-B) --------------------------- */

const PointSchema = z.object({ x: z.number().finite(), y: z.number().finite() });

const CustomPlaneSchema = z
  .object({
    key: z.string().min(1).max(40),
    name: z.string().min(1).max(80),
    ring: z.array(PointSchema).min(3).max(60),
    tilt_deg: z.number().finite().min(0).max(70),
    azimuth_deg: z.number().finite().min(-360).max(720),
    eave_height_m: z.number().finite().min(0).max(200),
    margin_m: z.number().finite().min(0).max(10),
    edge_margins: z
      .array(
        z.object({
          index: z.number().int().min(0).max(59),
          kind: z.enum(["faitage", "egout", "rive", "noue", "aretier", "indefini"]),
          margin_m: z.number().finite().min(0).max(10),
        }),
      )
      .max(60)
      .default([]),
  })
  .superRefine((plane, ctx) => {
    // Une marge ne peut viser qu'une arête réellement présente sur ce contour.
    for (const m of plane.edge_margins) {
      if (m.index >= plane.ring.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["edge_margins"],
          message: "Marge d'arête hors du contour.",
        });
      }
    }
  });

const SaveRoofPlanesSchema = z.object({
  companyId: z.string().uuid(),
  modelId: z.string().uuid(),
  planes: z.array(CustomPlaneSchema).max(30),
  // Obligatoire : aucune écriture géométrique sans détection de conflit.
  expectedGeometryVersion: z.number().int(),
});

/** Messages utilisateur pour les refus renvoyés par la transaction serveur. */
const ROOF_RPC_MESSAGE: Record<string, string> = {
  forbidden: "Droits insuffisants pour modifier cette toiture.",
  stale_geometry_version:
    "Une version plus récente de ce modèle existe (modifié depuis un autre onglet ou par un collègue). Rechargez la page avant d'enregistrer.",
  expected_geometry_version_required: "Rechargez la page avant d'enregistrer.",
  conversion_required:
    "Cette toiture provient des dimensions saisies. Convertissez-la d'abord en contours éditables : la conversion conserve les pans et l'implantation.",
  empty_polygon_geometry:
    "Une toiture dessinée doit garder au moins un pan. Supprimez plutôt les panneaux posés si nécessaire.",
  polygon_mode_is_final:
    "Cette toiture est dessinée : elle ne peut pas revenir automatiquement aux dimensions saisies.",
  building_not_found: "Aucune toiture à enregistrer.",
  model_not_found: "Modèle introuvable.",
  obstacle_not_found: "Obstacle introuvable.",
  obstacle_payload_required: "Obstacle incomplet.",
  plane_key_required: "Un pan n'a pas d'identifiant.",
};

function roofRpcError(message: string | undefined, fallback: string): Error {
  for (const [code, text] of Object.entries(ROOF_RPC_MESSAGE)) {
    if (message?.includes(code)) return new Error(text);
  }
  return new Error(fallback);
}

/**
 * Enregistre l'ensemble des pans dessinés (ajout, modification, suppression).
 * Écriture atomique du jeu complet : pas d'état partiel, et chaque contour est
 * revalidé ici — une géométrie refusée n'est jamais persistée.
 */
export const saveSolarRoofPlanes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => SaveRoofPlanesSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertSolarManage(supabase, data.companyId, userId);
    await loadModelScoped(supabase, data.companyId, data.modelId);

    const keys = new Set<string>();
    for (const plane of data.planes) {
      const check = validateRoofRing(plane.ring);
      if (!check.valid) throw new Error(`${plane.name} : ${check.message}`);
      if (keys.has(plane.key)) throw new Error("Deux pans portent le même identifiant.");
      keys.add(plane.key);
    }
    if (data.planes.length === 0) {
      throw new Error(
        "Une toiture dessinée doit garder au moins un pan. Supprimez plutôt les panneaux posés si nécessaire.",
      );
    }

    // Géométrie recalculée ici : le navigateur ne dicte jamais ce qui est écrit.
    const rows = data.planes.map((p) => rpcPlaneRow(p as CustomRoofPlane));

    const { error } = await supabase.rpc("solar_apply_roof_geometry", {
      _company_id: data.companyId,
      _model_id: data.modelId,
      _expected_geometry_version: data.expectedGeometryVersion,
      _mode: "polygon",
      _allow_mode_switch: false,
      _custom_planes: data.planes as never,
      _planes: rows as never,
    });
    if (error) throw roofRpcError(error.message, "Enregistrement de la toiture impossible.");

    return refreshSummary(supabase, data.companyId, data.modelId, userId);
  });

/** Ligne de pan telle qu'attendue par la transaction serveur. */
function rpcPlaneRow(plane: CustomRoofPlane) {
  const geo = planeFromCustom(plane);
  return {
    key: geo.key,
    name: geo.name,
    azimuth_deg: geo.azimuth_deg,
    tilt_deg: geo.tilt_deg,
    area_m2: geo.area_m2,
    eave_height_m: geo.eave_height_m,
    ridge_height_m: geo.ridge_height_m,
    polygon: { key: geo.key, points: geo.polygon, frame: geo.frame },
  };
}

/**
 * Passe une toiture paramétrique en contours éditables, sans rien détruire :
 * les paramètres d'origine restent enregistrés et les clés de pans sont
 * conservées (mise à jour par clé), donc les implantations existantes et leurs
 * panneaux posés sont intégralement préservés.
 */
export const convertRoofToEditable = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        companyId: z.string().uuid(),
        modelId: z.string().uuid(),
        expectedGeometryVersion: z.number().int(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertSolarManage(supabase, data.companyId, userId);
    await loadModelScoped(supabase, data.companyId, data.modelId);

    const { data: rows } = await supabase
      .from("solar_roof_planes")
      .select("*")
      .eq("model_id", data.modelId)
      .eq("company_id", data.companyId);
    const geometry = (rows ?? [])
      .map(planeGeometryFromRow)
      .filter((g): g is NonNullable<typeof g> => !!g);
    if (geometry.length === 0) throw new Error("Aucun pan à convertir.");

    const custom = customPlanesFromGeometry(geometry).filter((p) => validateRoofRing(p.ring).valid);
    if (custom.length === 0)
      throw new Error("Les pans actuels ne peuvent pas être convertis en contours.");

    const { error } = await supabase.rpc("solar_apply_roof_geometry", {
      _company_id: data.companyId,
      _model_id: data.modelId,
      _expected_geometry_version: data.expectedGeometryVersion,
      _mode: "polygon",
      // Seule la conversion explicite autorise le passage en contours.
      _allow_mode_switch: true,
      _custom_planes: custom as never,
      _planes: custom.map(rpcPlaneRow) as never,
    });
    if (error) throw roofRpcError(error.message, "Conversion impossible.");

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      action: "solar_roof.convert_editable",
      entityType: "solar_model",
      entityId: data.modelId,
    });
    return refreshSummary(supabase, data.companyId, data.modelId, userId);
  });

/* -------------------------------- Obstacles ------------------------------- */

export const saveSolarObstacle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => ObstacleInputSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertSolarManage(supabase, data.companyId, userId);
    await loadModelScoped(supabase, data.companyId, data.modelId);

    const { error } = await supabase.rpc("solar_apply_obstacle", {
      _company_id: data.companyId,
      _model_id: data.modelId,
      _expected_geometry_version: data.expectedGeometryVersion,
      _obstacle: {
        id: data.obstacleId ?? null,
        roof_plane_id: data.roofPlaneId ?? null,
        obstacle_type: data.obstacle_type,
        label: data.label ?? "",
        position_x_m: data.position_x_m,
        position_y_m: data.position_y_m,
        base_z_m: data.base_z_m ?? 0,
        width_m: data.width_m,
        length_m: data.length_m,
        height_m: data.height_m,
        rotation_deg: data.rotation_deg ?? 0,
        clearance_m: data.clearance_m ?? 0.3,
        casts_shadow: data.casts_shadow ?? true,
        data_source: data.data_source ?? "manuel",
      } as never,
      _delete_id: null as never,
    });
    if (error) throw roofRpcError(error.message, "Enregistrement de l'obstacle impossible.");
    return refreshSummary(supabase, data.companyId, data.modelId, userId);
  });

export const deleteSolarObstacle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        companyId: z.string().uuid(),
        modelId: z.string().uuid(),
        obstacleId: z.string().uuid(),
        expectedGeometryVersion: z.number().int(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertSolarManage(supabase, data.companyId, userId);
    const { error } = await supabase.rpc("solar_apply_obstacle", {
      _company_id: data.companyId,
      _model_id: data.modelId,
      _expected_geometry_version: data.expectedGeometryVersion,
      _obstacle: null as never,
      _delete_id: data.obstacleId,
    });
    if (error) throw roofRpcError(error.message, "Suppression impossible.");
    return refreshSummary(supabase, data.companyId, data.modelId, userId);
  });

/* ------------------------------ Implantation ------------------------------ */

export const generateSolarLayout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => LayoutRequestSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertSolarManage(supabase, data.companyId, userId);
    await loadModelScoped(supabase, data.companyId, data.modelId);

    const { data: planeRow, error: planeErr } = await supabase
      .from("solar_roof_planes")
      .select("*")
      .eq("id", data.roofPlaneId)
      .eq("model_id", data.modelId)
      .eq("company_id", data.companyId)
      .maybeSingle();
    if (planeErr || !planeRow) throw new Error("Pan de toiture introuvable.");
    const geo = planeGeometryFromRow(planeRow);
    if (!geo) throw new Error("Géométrie du pan indisponible : réenregistrez le bâtiment.");

    const { data: spec, error: specErr } = await supabase
      .from("solar_module_catalog")
      .select("*")
      .eq("id", data.moduleCatalogId)
      .or(`company_id.is.null,company_id.eq.${data.companyId}`)
      .maybeSingle();
    if (specErr || !spec) throw new Error("Panneau introuvable dans le catalogue.");

    const { data: obstacleRows } = await supabase
      .from("solar_obstacles")
      .select("*")
      .eq("model_id", data.modelId)
      .eq("company_id", data.companyId)
      .eq("roof_plane_id", data.roofPlaneId);

    const obstacles: PlaneObstacle[] = (obstacleRows ?? []).map((o) => ({
      id: o.id,
      u: o.position_x_m,
      v: o.position_y_m,
      width_m: o.width_m,
      length_m: o.length_m,
      clearance_m: o.clearance_m,
    }));

    const { data: zoneRows } = await supabase
      .from("solar_zones")
      .select("*")
      .eq("model_id", data.modelId)
      .eq("company_id", data.companyId)
      .eq("roof_plane_id", data.roofPlaneId)
      .eq("zone_type", "interdite");

    const forbidden = (zoneRows ?? [])
      .map((z) => (z.polygon as unknown as { x: number; y: number }[] | null) ?? [])
      .filter((poly) => poly.length >= 3);

    const placement = gridLayout(geo, spec, obstacles, {
      setback_m: data.setback_m,
      row_gap_m: data.row_gap_m,
      col_gap_m: data.col_gap_m,
      orientation: data.orientation,
      forbidden,
      ...(data.max_modules ? { max_modules: data.max_modules } : {}),
    });

    // Un champ par pan : on remplace intégralement son implantation.
    const { data: arrayRows } = await supabase
      .from("solar_arrays")
      .select("*")
      .eq("model_id", data.modelId)
      .eq("company_id", data.companyId)
      .eq("roof_plane_id", data.roofPlaneId)
      .limit(1);

    let arrayId = arrayRows?.[0]?.id ?? null;
    const arrayPayload = {
      company_id: data.companyId,
      model_id: data.modelId,
      roof_plane_id: data.roofPlaneId,
      module_catalog_id: data.moduleCatalogId,
      label: `Champ ${planeRow.name}`,
      orientation: data.orientation,
      row_gap_m: data.row_gap_m,
      col_gap_m: data.col_gap_m,
      params: { setback_m: data.setback_m } as never,
    };

    if (arrayId) {
      await supabase
        .from("solar_arrays")
        .update(arrayPayload)
        .eq("id", arrayId)
        .eq("company_id", data.companyId);
      await supabase
        .from("solar_modules_placed")
        .delete()
        .eq("array_id", arrayId)
        .eq("company_id", data.companyId);
    } else {
      const { data: created, error } = await supabase
        .from("solar_arrays")
        .insert(arrayPayload)
        .select("id")
        .single();
      if (error) throw new Error("Création du champ impossible.");
      arrayId = created.id;
    }

    if (placement.length) {
      const { error } = await supabase.from("solar_modules_placed").insert(
        placement.map((m, index) => ({
          company_id: data.companyId,
          model_id: data.modelId,
          array_id: arrayId!,
          roof_plane_id: data.roofPlaneId,
          index_label: index + 1,
          grid_row: m.grid_row,
          grid_col: m.grid_col,
          local_u_m: m.local_u_m,
          local_v_m: m.local_v_m,
          orientation: m.orientation,
          enabled: true,
        })),
      );
      if (error) throw new Error("Enregistrement des panneaux impossible.");
    }

    return refreshSummary(supabase, data.companyId, data.modelId, userId);
  });

export const toggleSolarModule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => ToggleModuleSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertSolarManage(supabase, data.companyId, userId);
    const { error } = await supabase
      .from("solar_modules_placed")
      .update({ enabled: data.enabled })
      .eq("id", data.moduleId)
      .eq("model_id", data.modelId)
      .eq("company_id", data.companyId);
    if (error) throw new Error("Mise à jour du panneau impossible.");
    return refreshSummary(supabase, data.companyId, data.modelId, userId);
  });

export const clearSolarLayout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        companyId: z.string().uuid(),
        modelId: z.string().uuid(),
        roofPlaneId: z.string().uuid(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertSolarManage(supabase, data.companyId, userId);
    await supabase
      .from("solar_modules_placed")
      .delete()
      .eq("roof_plane_id", data.roofPlaneId)
      .eq("model_id", data.modelId)
      .eq("company_id", data.companyId);
    return refreshSummary(supabase, data.companyId, data.modelId, userId);
  });

/* ------------------------- Métadonnées et versions ------------------------ */

export const updateSolarModel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => ModelMetaSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertSolarManage(supabase, data.companyId, userId);
    const patch: Database["public"]["Tables"]["solar_models"]["Update"] = { updated_by: userId };
    if (data.name !== undefined) patch.name = data.name;
    if (data.quality_level !== undefined) patch.quality_level = data.quality_level;
    const { error } = await supabase
      .from("solar_models")
      .update(patch)
      .eq("id", data.modelId)
      .eq("company_id", data.companyId);
    if (error) throw new Error("Enregistrement impossible.");
    return refreshSummary(supabase, data.companyId, data.modelId, userId);
  });

export const createSolarVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => VersionSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertSolarManage(supabase, data.companyId, userId);
    const full = await loadFullModel(supabase, data.companyId, data.modelId);

    const { data: last } = await supabase
      .from("solar_model_versions")
      .select("version_number")
      .eq("model_id", data.modelId)
      .eq("company_id", data.companyId)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { error } = await supabase.from("solar_model_versions").insert({
      company_id: data.companyId,
      model_id: data.modelId,
      version_number: (last?.version_number ?? 0) + 1,
      label: data.label ?? "",
      quality_level: full.model.quality_level,
      schema_version: SOLAR_SCHEMA_VERSION,
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
    if (error) throw new Error("Enregistrement de la version impossible.");

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      action: "solar_model.version",
      entityType: "solar_model",
      entityId: data.modelId,
      metadata: { label: data.label ?? "" },
    });

    return loadFullModel(supabase, data.companyId, data.modelId);
  });

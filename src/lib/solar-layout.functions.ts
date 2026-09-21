/**
 * Smart PV Layout Engine — fonctions serveur.
 *
 * Le navigateur calcule des aperçus (Web Worker) mais ne dicte jamais la
 * géométrie enregistrée : à l'application d'une variante, le serveur rejoue
 * le moteur avec les mêmes entrées (moteur déterministe) puis écrit en une
 * seule opération atomique.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import {
  assertSolarManage,
  assertSolarMember,
  loadModelScoped,
  planeGeometryFromRow,
  refreshSummary,
} from "@/lib/solar.server";
import {
  hasUsableDimensions,
  MISSING_DIMENSIONS_MESSAGE,
  type ModuleSnapshot,
} from "@/lib/solar/module-catalog";
import { parseCustomPlanes, type CustomRoofPlane } from "@/lib/solar/polygon";
import {
  EMPTY_RULES_PROFILE,
  generateLayouts,
  validateLayout,
  type LayoutCandidate,
  type LayoutModule,
  type LayoutPlane,
  type LayoutModuleSpec,
  type RulesProfile,
  LAYOUT_ENGINE_VERSION,
} from "@/lib/solar-layout";

type SB = Parameters<typeof assertSolarMember>[0];

const StrategySchema = z.enum(["equilibre", "esthetique", "maximum"]);
const OrientationModeSchema = z.enum(["auto", "portrait", "paysage", "mixte"]);
const TargetSchema = z.object({
  mode: z.enum(["max", "power", "count"]),
  power_kwc: z.number().min(0).max(2000).optional(),
  count: z.number().int().min(0).max(5000).optional(),
  rounding: z.enum(["closest", "under", "over"]).default("closest"),
});

const RulesInputSchema = z.object({
  id: z.string().default("inline"),
  name: z.string().default("Profil"),
  version: z.number().int().default(1),
  eave_m: z.number().min(0).max(10),
  ridge_m: z.number().min(0).max(10),
  verge_m: z.number().min(0).max(10),
  valley_m: z.number().min(0).max(10),
  hip_m: z.number().min(0).max(10),
  obstacle_m: z.number().min(0).max(10),
  row_gap_m: z.number().min(0).max(5),
  col_gap_m: z.number().min(0).max(5),
  walkway_m: z.number().min(0).max(10),
});

const BaseSchema = z.object({
  companyId: z.string().uuid(),
  modelId: z.string().uuid(),
});

const ComputeSchema = BaseSchema.extend({
  planeIds: z.array(z.string().uuid()).min(1).max(12),
  moduleVariantId: z.string().uuid(),
  rulesProfileId: z.string().uuid().nullable().optional(),
  rules: RulesInputSchema.optional(),
  target: TargetSchema,
  orientation: OrientationModeSchema.default("auto"),
  strategies: z.array(StrategySchema).optional(),
  maxVariants: z.number().int().min(1).max(6).default(3),
});

/* ------------------------------ Chargements ------------------------------- */

async function loadRules(
  sb: SB,
  companyId: string,
  profileId: string | null | undefined,
  inline: z.infer<typeof RulesInputSchema> | undefined,
): Promise<RulesProfile> {
  if (profileId) {
    const { data } = await sb
      .from("solar_rules_profiles")
      .select("*")
      .eq("id", profileId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (data) {
      return {
        id: data.id,
        name: data.name,
        version: data.version,
        eave_m: Number(data.eave_m),
        ridge_m: Number(data.ridge_m),
        verge_m: Number(data.verge_m),
        valley_m: Number(data.valley_m),
        hip_m: Number(data.hip_m),
        obstacle_m: Number(data.obstacle_m),
        row_gap_m: Number(data.row_gap_m),
        col_gap_m: Number(data.col_gap_m),
        walkway_m: Number(data.walkway_m),
      };
    }
  }
  if (inline) return { ...EMPTY_RULES_PROFILE, ...inline };
  return EMPTY_RULES_PROFILE;
}

interface PlaneBundle {
  planes: LayoutPlane[];
  idByKey: Map<string, string>;
  nameByKey: Map<string, string>;
}

async function loadPlanes(
  sb: SB,
  companyId: string,
  modelId: string,
  planeIds: string[],
): Promise<PlaneBundle> {
  const { data: rows } = await sb
    .from("solar_roof_planes")
    .select("*")
    .eq("model_id", modelId)
    .eq("company_id", companyId)
    .in("id", planeIds);
  if (!rows?.length) throw new Error("Pan de toiture introuvable.");

  const [{ data: obstacles }, { data: zones }, { data: building }] = await Promise.all([
    sb.from("solar_obstacles").select("*").eq("model_id", modelId).eq("company_id", companyId),
    sb.from("solar_zones").select("*").eq("model_id", modelId).eq("company_id", companyId),
    sb
      .from("solar_buildings")
      .select("geometry_mode, custom_planes")
      .eq("model_id", modelId)
      .eq("company_id", companyId)
      .maybeSingle(),
  ]);

  // Marges saisies en P0-B : elles font autorité sur le profil de règles.
  const customByKey = new Map<string, CustomRoofPlane>();
  if (building?.geometry_mode === "polygon") {
    for (const p of parseCustomPlanes(building.custom_planes)) customByKey.set(p.key, p);
  }

  const idByKey = new Map<string, string>();
  const nameByKey = new Map<string, string>();
  const planes: LayoutPlane[] = [];

  // L'ordre suit celui demandé par l'utilisateur (priorité des pans).
  for (const planeId of planeIds) {
    const row = rows.find((r) => r.id === planeId);
    if (!row) continue;
    const geo = planeGeometryFromRow(row);
    if (!geo) throw new Error("Géométrie du pan indisponible : réenregistrez le bâtiment.");
    idByKey.set(geo.key, row.id);
    nameByKey.set(geo.key, row.name);
    const custom = customByKey.get(geo.key);
    planes.push({
      key: geo.key,
      name: row.name,
      azimuth_deg: geo.azimuth_deg,
      tilt_deg: geo.tilt_deg,
      polygon: geo.polygon,
      ...(custom ? { margin_m: custom.margin_m } : {}),
      ...(custom?.edge_margins.length
        ? {
            edges: custom.edge_margins
              .filter((m) => m.index < geo.polygon.length)
              .map((m) => ({ index: m.index, kind: m.kind, margin_m: m.margin_m })),
          }
        : {}),
      obstacles: (obstacles ?? [])
        .filter((o) => o.roof_plane_id === row.id)
        .map((o) => ({
          id: o.id,
          label: o.label || o.obstacle_type || "Obstacle",
          u: Number(o.position_x_m),
          v: Number(o.position_y_m),
          width_m: Number(o.width_m),
          length_m: Number(o.length_m),
          ...(o.clearance_m !== null ? { clearance_m: Number(o.clearance_m) } : {}),
        })),
      zones: (zones ?? [])
        .filter((z) => z.roof_plane_id === row.id)
        .map((z) => ({
          id: z.id,
          type: z.zone_type as LayoutPlane["zones"][number]["type"],
          polygon: ((z.polygon as unknown as { x: number; y: number }[] | null) ?? []).map((p) => ({
            x: Number(p.x),
            y: Number(p.y),
          })),
        }))
        .filter((z) => z.polygon.length >= 3),
    });
  }
  if (!planes.length) throw new Error("Aucun pan exploitable.");
  return { planes, idByKey, nameByKey };
}

/**
 * Résout une référence du catalogue : dimensions RÉELLES publiées.
 * Aucune dimension de repli : sans dimensions, la référence est refusée.
 */
async function loadSpec(
  sb: SB,
  companyId: string,
  variantId: string,
): Promise<{ spec: LayoutModuleSpec; snapshot: ModuleSnapshot }> {
  const { data } = await sb
    .from("solar_module_variants")
    .select(
      "id, model, pmax_stc_w, confidence, primary_source, company_id, current_revision_id, series:solar_module_series!inner(name, width_mm, height_mm, depth_mm, weight_kg, manufacturer:solar_manufacturers!inner(name))",
    )
    .eq("id", variantId)
    .or(`company_id.is.null,company_id.eq.${companyId}`)
    .maybeSingle();
  if (!data) throw new Error("Panneau introuvable dans le catalogue.");

  const row = data as unknown as {
    id: string;
    model: string;
    pmax_stc_w: number | null;
    confidence: string | null;
    primary_source: string | null;
    current_revision_id: string | null;
    series: {
      name: string;
      width_mm: number | null;
      height_mm: number | null;
      depth_mm: number | null;
      weight_kg: number | null;
      manufacturer: { name: string };
    };
  };

  const dims = {
    width_mm: row.series.width_mm,
    height_mm: row.series.height_mm,
    depth_mm: row.series.depth_mm,
  };
  if (!hasUsableDimensions(dims)) throw new Error(MISSING_DIMENSIONS_MESSAGE);
  if (!row.pmax_stc_w) throw new Error("Puissance non publiée pour cette référence.");

  return {
    spec: {
      id: row.id,
      width_mm: dims.width_mm!,
      height_mm: dims.height_mm!,
      power_wc: row.pmax_stc_w,
    },
    snapshot: {
      variant_id: row.id,
      revision_id: row.current_revision_id,
      manufacturer: row.series.manufacturer.name,
      series: row.series.name,
      model: row.model,
      power_wc: row.pmax_stc_w,
      width_mm: dims.width_mm!,
      height_mm: dims.height_mm!,
      depth_mm: dims.depth_mm,
      weight_kg: row.series.weight_kg,
      confidence: (row.confidence as ModuleSnapshot["confidence"]) ?? "a_verifier",
      source: row.primary_source,
    },
  };
}

/* ------------------------------- Catalogue -------------------------------- */

export const getLayoutSetup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertSolarMember(supabase, data.companyId, userId);
    const { data: profiles } = await supabase
      .from("solar_rules_profiles")
      .select("*")
      .eq("company_id", data.companyId)
      .order("name");
    return { profiles: profiles ?? [] };
  });

/* --------------------------- Profils de règles ---------------------------- */

export const saveRulesProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        companyId: z.string().uuid(),
        profileId: z.string().uuid().nullable().optional(),
        name: z.string().min(2).max(80),
        rules: RulesInputSchema.omit({ id: true, name: true, version: true }),
        isDefault: z.boolean().default(false),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertSolarManage(supabase, data.companyId, userId);
    const payload = {
      ...data.rules,
      name: data.name,
      is_default: data.isDefault,
      company_id: data.companyId,
    };
    if (data.profileId) {
      const { error } = await supabase
        .from("solar_rules_profiles")
        .update(payload)
        .eq("id", data.profileId)
        .eq("company_id", data.companyId);
      if (error) throw new Error("Enregistrement du profil impossible.");
      return { id: data.profileId };
    }
    const { data: created, error } = await supabase
      .from("solar_rules_profiles")
      .insert({ ...payload, created_by: userId })
      .select("id")
      .single();
    if (error) throw new Error("Création du profil impossible.");
    return { id: created.id };
  });

export const deleteRulesProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ companyId: z.string().uuid(), profileId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertSolarManage(supabase, data.companyId, userId);
    const { error } = await supabase
      .from("solar_rules_profiles")
      .delete()
      .eq("id", data.profileId)
      .eq("company_id", data.companyId);
    if (error) throw new Error("Suppression du profil impossible.");
    return { ok: true };
  });

/* ----------------------------- Calcul (aperçu) ---------------------------- */

export const computeSmartLayout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => ComputeSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertSolarMember(supabase, data.companyId, userId);
    const model = await loadModelScoped(supabase, data.companyId, data.modelId);
    const [{ planes, nameByKey }, { spec, snapshot }, rules] = await Promise.all([
      loadPlanes(supabase, data.companyId, data.modelId, data.planeIds),
      loadSpec(supabase, data.companyId, data.moduleVariantId),
      loadRules(supabase, data.companyId, data.rulesProfileId, data.rules),
    ]);
    const result = generateLayouts({
      planes,
      module: spec,
      rules,
      target: data.target,
      orientation: data.orientation,
      ...(data.strategies?.length ? { strategies: data.strategies } : {}),
      max_variants: data.maxVariants,
    });
    // Le client renverra ces références à l'application : toute dérive
    // (toiture, obstacle, marge, panneau, profil) sera détectée côté serveur.
    return {
      ...result,
      plane_names: Object.fromEntries(nameByKey),
      geometry_version: model.geometry_version,
      module_snapshot: snapshot,
      rules_profile_id: rules.id,
      rules_profile_version: rules.version,
    };
  });

/* -------------------------- Application atomique -------------------------- */

const ApplySchema = ComputeSchema.extend({
  /**
   * Empreinte exacte de la variante calculée : le serveur rejoue le moteur et
   * n'écrit que si cette empreinte existe encore à l'identique.
   */
  signature: z.string().min(1).max(200000),
  strategy: StrategySchema.optional(),
  /** Version de géométrie renvoyée par le calcul : obligatoire. */
  geometryVersion: z.number().int(),
  saveAsVariant: z.boolean().default(false),
  variantLabel: z.string().min(1).max(80).optional(),
});

export const applySmartLayout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => ApplySchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertSolarManage(supabase, data.companyId, userId);
    const model = await loadModelScoped(supabase, data.companyId, data.modelId);

    // La toiture ou un obstacle a bougé depuis le calcul : on refuse d'écrire.
    if (model.geometry_version !== data.geometryVersion) {
      throw new Error(
        "La toiture a été modifiée depuis le calcul. Relancez le calcul des implantations avant d'appliquer.",
      );
    }

    const [{ planes, idByKey }, { spec, snapshot }, rules] = await Promise.all([
      loadPlanes(supabase, data.companyId, data.modelId, data.planeIds),
      loadSpec(supabase, data.companyId, data.moduleVariantId),
      loadRules(supabase, data.companyId, data.rulesProfileId, data.rules),
    ]);

    // Le moteur est rejoué côté serveur : le navigateur ne dicte pas la géométrie.
    const result = generateLayouts({
      planes,
      module: spec,
      rules,
      target: data.target,
      orientation: data.orientation,
      ...(data.strategies?.length ? { strategies: data.strategies } : {}),
      max_variants: data.maxVariants,
    });

    // Aucun repli : une empreinte inconnue n'est jamais appliquée.
    const chosen: LayoutCandidate | undefined = result.candidates.find(
      (c) => c.signature === data.signature,
    );
    if (!chosen) {
      throw new Error(
        "Cette implantation n'est plus valable avec les contraintes actuelles. Relancez le calcul des implantations.",
      );
    }

    const variantId = data.saveAsVariant
      ? await insertVariant(supabase, {
          companyId: data.companyId,
          modelId: data.modelId,
          geometryVersion: model.geometry_version,
          label: data.variantLabel ?? chosen.label,
          candidate: chosen,
          moduleVariantId: data.moduleVariantId,
          rules,
          rulesProfileId: data.rulesProfileId ?? null,
          target: data.target,
          orientation: data.orientation,
          userId,
        })
      : null;

    await writeLayout(supabase, {
      companyId: data.companyId,
      modelId: data.modelId,
      geometryVersion: data.geometryVersion ?? model.geometry_version,
      modules: chosen.modules,
      planes,
      spec,
      rules,
      idByKey,
      snapshot,
      rulesProfileId: data.rulesProfileId ?? null,
      variantId,
    });

    // Historique « utilisés récemment » du catalogue.
    await supabase.rpc("solar_catalog_touch_module", {
      _company_id: data.companyId,
      _variant_id: data.moduleVariantId,
    });

    const summary = await refreshSummary(supabase, data.companyId, data.modelId, userId);
    return { summary, candidate: chosen, result, variant_id: variantId };
  });

const ManualModuleSchema = z.object({
  id: z.string().min(1).max(80),
  plane_key: z.string().min(1).max(80),
  u: z.number().finite(),
  v: z.number().finite(),
  orientation: z.enum(["portrait", "paysage"]),
  row: z.number().int().default(0),
  col: z.number().int().default(0),
  matrix: z.number().int().default(0),
});

const ManualSchema = ComputeSchema.omit({
  target: true,
  strategies: true,
  maxVariants: true,
}).extend({
  modules: z.array(ManualModuleSchema).max(2000),
  geometryVersion: z.number().int().optional(),
});

/** Enregistre une implantation modifiée à la main, avec sa validation serveur. */
export const applyManualLayout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => ManualSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertSolarManage(supabase, data.companyId, userId);
    const model = await loadModelScoped(supabase, data.companyId, data.modelId);

    const [{ planes, idByKey }, { spec, snapshot }, rules] = await Promise.all([
      loadPlanes(supabase, data.companyId, data.modelId, data.planeIds),
      loadSpec(supabase, data.companyId, data.moduleVariantId),
      loadRules(supabase, data.companyId, data.rulesProfileId, data.rules),
    ]);

    const modules: LayoutModule[] = data.modules.filter((m) => idByKey.has(m.plane_key));
    await writeLayout(supabase, {
      companyId: data.companyId,
      modelId: data.modelId,
      geometryVersion: data.geometryVersion ?? model.geometry_version,
      modules,
      planes,
      spec,
      rules,
      idByKey,
      snapshot,
      rulesProfileId: data.rulesProfileId ?? null,
      variantId: null,
    });

    const summary = await refreshSummary(supabase, data.companyId, data.modelId, userId);
    return { summary, validity: validateLayout(planes, modules, spec, rules) };
  });

interface WriteArgs {
  companyId: string;
  modelId: string;
  geometryVersion: number;
  modules: LayoutModule[];
  planes: LayoutPlane[];
  spec: LayoutModuleSpec;
  rules: RulesProfile;
  idByKey: Map<string, string>;
  snapshot: ModuleSnapshot;
  rulesProfileId: string | null;
  variantId: string | null;
}

async function writeLayout(sb: SB, args: WriteArgs) {
  const validity = validateLayout(args.planes, args.modules, args.spec, args.rules);
  const statusById = new Map(validity.map((v) => [v.module_id, v]));

  const arrays = args.planes.map((plane) => {
    const planeModules = args.modules.filter((m) => m.plane_key === plane.key);
    return {
      roof_plane_id: args.idByKey.get(plane.key),
      module_variant_id: args.snapshot.variant_id,
      module_revision_id: args.snapshot.revision_id,
      module_snapshot: args.snapshot,
      label: `Champ ${plane.name}`,
      orientation: planeModules[0]?.orientation ?? "portrait",
      row_gap_m: args.rules.row_gap_m,
      col_gap_m: args.rules.col_gap_m,
      rules_profile_id: args.rulesProfileId,
      rules_profile_version: args.rules.version,
      layout_engine_version: LAYOUT_ENGINE_VERSION,
      variant_id: args.variantId,
      params: { rules: args.rules },
      modules: planeModules.map((m) => ({
        grid_row: m.row,
        grid_col: m.col,
        local_u_m: m.u,
        local_v_m: m.v,
        orientation: m.orientation,
        enabled: true,
        validity_status: statusById.get(m.id)?.status ?? "valid",
        validity_cause: statusById.get(m.id)?.cause ?? null,
      })),
    };
  });

  const { error } = await sb.rpc("solar_apply_layout", {
    _company_id: args.companyId,
    _model_id: args.modelId,
    _expected_geometry_version: args.geometryVersion,
    _arrays: arrays as never,
  });
  if (error) {
    if (error.message.includes("stale_geometry_version")) {
      throw new Error(
        "Le bâtiment a été modifié entre-temps. Rechargez la page avant d'enregistrer.",
      );
    }
    throw new Error("Enregistrement de l'implantation impossible.");
  }
}

interface VariantArgs {
  companyId: string;
  modelId: string;
  geometryVersion: number;
  label: string;
  candidate: LayoutCandidate;
  moduleVariantId: string;
  rules: RulesProfile;
  rulesProfileId: string | null;
  target: z.infer<typeof TargetSchema>;
  orientation: z.infer<typeof OrientationModeSchema>;
  userId: string;
}

async function insertVariant(sb: SB, a: VariantArgs): Promise<string | null> {
  const row: Database["public"]["Tables"]["solar_layout_variants"]["Insert"] = {
    company_id: a.companyId,
    model_id: a.modelId,
    geometry_version: a.geometryVersion,
    label: a.label,
    strategy: a.candidate.strategy,
    orientation_mode: a.orientation,
    target_mode: a.target.mode,
    ...(a.target.power_kwc !== undefined ? { target_power_kwc: a.target.power_kwc } : {}),
    module_variant_id: a.moduleVariantId,
    rules_profile_id: a.rulesProfileId,
    rules_profile_version: a.rules.version,
    rules_snapshot: a.rules as never,
    layout_engine_version: a.candidate.engine_version,
    module_count: a.candidate.modules.length,
    power_kwc: a.candidate.power_kwc,
    criteria: a.candidate.criteria as never,
    modules: a.candidate.modules as never,
    created_by: a.userId,
  };
  const { data, error } = await sb.from("solar_layout_variants").insert(row).select("id").single();
  if (error) return null;
  return data.id;
}

export const listLayoutVariants = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => BaseSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertSolarMember(supabase, data.companyId, userId);
    const { data: rows } = await supabase
      .from("solar_layout_variants")
      .select("*")
      .eq("company_id", data.companyId)
      .eq("model_id", data.modelId)
      .order("created_at", { ascending: false })
      .limit(30);
    return rows ?? [];
  });

export const deleteLayoutVariant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => BaseSchema.extend({ variantId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertSolarManage(supabase, data.companyId, userId);
    await supabase
      .from("solar_layout_variants")
      .delete()
      .eq("id", data.variantId)
      .eq("company_id", data.companyId);
    return { ok: true };
  });

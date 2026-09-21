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
import {
  customPlaneMatchesPolygon,
  parseCustomPlanes,
  type CustomRoofPlane,
} from "@/lib/solar/polygon";
import {
  assertManualArraysCompatible,
  manualGuardFailure,
  manualInvalidMessage,
  type ManualArrayRef,
} from "@/lib/solar-layout/manual-server";
import {
  applyLayoutRpcArgs,
  assertApplyRpcArgs,
  buildArrayPayloads,
  buildVariantPayload,
  candidateToken,
  computeContextToken,
  manualContextToken,
  EMPTY_RULES_PROFILE,
  generateLayouts,
  validateLayout,
  type ApplyVariantPayload,
  type ComputeContext,
  type LayoutCandidate,
  type LayoutModule,
  type LayoutPlane,
  type LayoutModuleSpec,
  type RulesProfile,
  LAYOUT_ENGINE_VERSION,
} from "@/lib/solar-layout";

/** Message unique lorsqu'une entrée du calcul a changé avant l'écriture. */
const DRIFT_MESSAGE =
  "Le panneau ou les règles ont changé depuis le calcul. Relancez le calcul des implantations.";

/** Contour du pan désynchronisé des marges d'arête saisies : calcul refusé. */
const DESYNC_MESSAGE = "La géométrie du pan est désynchronisée. Réenregistrez la toiture.";

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
    // Les marges d'arête sont indexées sur le contour dessiné : si le contour
    // enregistré du pan ne correspond plus exactement, on refuse le calcul
    // plutôt que d'appliquer une marge à la mauvaise arête.
    if (custom && !customPlaneMatchesPolygon(custom, geo.polygon)) {
      throw new Error(DESYNC_MESSAGE);
    }
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

/**
 * Contexte figé d'un calcul : toutes les entrées réellement utilisées.
 * Reconstruit à l'identique au moment de l'application ; la moindre dérive
 * (révision de panneau, dimensions, règles, version du moteur) change le jeton.
 */
function buildContext(i: {
  geometryVersion: number;
  geometryHash: string | null;
  snapshot: ModuleSnapshot;
  rules: RulesProfile;
  rulesProfileId: string | null;
  planePriority: string[];
  target: z.infer<typeof TargetSchema>;
  orientation: z.infer<typeof OrientationModeSchema>;
  strategies?: z.infer<typeof StrategySchema>[];
}): ComputeContext {
  return {
    geometry_version: i.geometryVersion,
    geometry_hash: i.geometryHash,
    module: {
      variant_id: i.snapshot.variant_id,
      revision_id: i.snapshot.revision_id ?? null,
      width_mm: i.snapshot.width_mm,
      height_mm: i.snapshot.height_mm,
      depth_mm: i.snapshot.depth_mm ?? null,
      power_wc: i.snapshot.power_wc,
      manufacturer: i.snapshot.manufacturer,
      model: i.snapshot.model,
    },
    rules_profile_id: i.rulesProfileId,
    rules_profile_version: i.rules.version,
    rules: i.rules,
    engine_version: LAYOUT_ENGINE_VERSION,
    plane_priority: i.planePriority,
    target: i.target,
    orientation: i.orientation,
    ...(i.strategies?.length ? { strategies: i.strategies } : {}),
  };
}

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
    // Priorité explicite : l'ordre choisi par l'utilisateur, jamais implicite.
    const planePriority = planes.map((p) => p.key);
    const result = generateLayouts({
      planes,
      plane_priority: planePriority,
      module: spec,
      rules,
      target: data.target,
      orientation: data.orientation,
      ...(data.strategies?.length ? { strategies: data.strategies } : {}),
      max_variants: data.maxVariants,
    });
    const ctx = buildContext({
      geometryVersion: model.geometry_version,
      geometryHash: model.geometry_hash ?? null,
      snapshot,
      rules,
      rulesProfileId: data.rulesProfileId ?? null,
      planePriority,
      target: data.target,
      orientation: data.orientation,
      ...(data.strategies?.length ? { strategies: data.strategies } : {}),
    });
    const contextToken = computeContextToken(ctx);

    // Le client renverra ce jeton à l'application : toute dérive (toiture,
    // obstacle, marge, révision de panneau, règles) est détectée côté serveur.
    return {
      ...result,
      plane_names: Object.fromEntries(nameByKey),
      geometry_version: model.geometry_version,
      geometry_hash: model.geometry_hash ?? null,
      module_snapshot: snapshot,
      module_revision_id: snapshot.revision_id ?? null,
      rules_profile_id: rules.id,
      rules_profile_version: rules.version,
      rules_snapshot: rules,
      plane_priority: planePriority,
      compute_token: contextToken,
      /** Jeton exact à renvoyer pour appliquer une variante donnée. */
      candidate_tokens: Object.fromEntries(
        result.candidates.map((c) => [c.signature, candidateToken(contextToken, c.signature)]),
      ),
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
  /** Jeton du calcul : fige panneau, révision, règles, moteur et pans. */
  computeToken: z.string().min(1).max(500),
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
    const planePriority = planes.map((p) => p.key);

    // Contexte reconstruit depuis la base : révision de panneau, dimensions,
    // puissance, règles (version ET contenu) et version du moteur compris.
    const ctx = buildContext({
      geometryVersion: model.geometry_version,
      geometryHash: model.geometry_hash ?? null,
      snapshot,
      rules,
      rulesProfileId: data.rulesProfileId ?? null,
      planePriority,
      target: data.target,
      orientation: data.orientation,
      ...(data.strategies?.length ? { strategies: data.strategies } : {}),
    });
    if (data.computeToken !== candidateToken(computeContextToken(ctx), data.signature)) {
      throw new Error(DRIFT_MESSAGE);
    }

    // Le moteur est rejoué côté serveur : le navigateur ne dicte pas la géométrie.
    const result = generateLayouts({
      planes,
      plane_priority: planePriority,
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

    // Variante et implantation partent dans LA MÊME transaction SQL :
    // un échec d'écriture ne laisse jamais de variante orpheline.
    const write = await writeLayout(supabase, {
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
      variant: data.saveAsVariant
        ? buildVariantPayload({
            label: data.variantLabel ?? chosen.label,
            candidate: chosen,
            moduleVariantId: data.moduleVariantId,
            snapshot,
            rules,
            rulesProfileId: data.rulesProfileId ?? null,
            target: data.target,
            orientation: data.orientation,
          })
        : null,
    });

    // Historique « utilisés récemment » : confort catalogue, hors cohérence
    // de l'implantation. Son échec ne doit jamais annuler l'écriture.
    const { error: touchError } = await supabase.rpc("solar_catalog_touch_module", {
      _company_id: data.companyId,
      _variant_id: data.moduleVariantId,
    });
    if (touchError) console.warn("solar_catalog_touch_module", touchError.message);

    const summary = await refreshSummary(supabase, data.companyId, data.modelId, userId);
    return { summary, candidate: chosen, result, variant_id: write.variantId };
  });

/* ------------------------ Édition manuelle (P0-D) ------------------------- */

const ManualModuleSchema = z.object({
  id: z.string().min(1).max(80),
  plane_key: z.string().min(1).max(80),
  u: z.number().finite().min(-2000).max(2000),
  v: z.number().finite().min(-2000).max(2000),
  orientation: z.enum(["portrait", "paysage"]),
  row: z.number().int().default(0),
  col: z.number().int().default(0),
  matrix: z.number().int().default(0),
});

const ManualSchema = BaseSchema.extend({
  /** Version de toiture chargée à l'ouverture de l'édition : OBLIGATOIRE. */
  geometryVersion: z.number().int(),
  /** Jeton du contexte d'édition, délivré par `getManualEditContext`. */
  manualToken: z.string().min(1).max(500),
  modules: z.array(ManualModuleSchema).max(2000),
  /** Confirmation explicite d'une implantation vidée de tous ses panneaux. */
  allowEmpty: z.boolean().default(false),
});

const StoredSnapshotSchema = z.object({
  variant_id: z.string().uuid(),
  revision_id: z.string().uuid().nullable().optional(),
  manufacturer: z.string().nullable().optional(),
  series: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  power_wc: z.number().positive(),
  width_mm: z.number().positive(),
  height_mm: z.number().positive(),
  depth_mm: z.number().positive().nullable().optional(),
  weight_kg: z.number().positive().nullable().optional(),
  confidence: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
});

const NO_LAYOUT_MESSAGE = "Aucune implantation à modifier : calculez d'abord une implantation.";

interface ManualServerContext {
  planes: LayoutPlane[];
  idByKey: Map<string, string>;
  nameByKey: Map<string, string>;
  spec: LayoutModuleSpec;
  snapshot: ModuleSnapshot;
  rules: RulesProfile;
  rulesProfileId: string | null;
  modules: LayoutModule[];
  geometryVersion: number;
  geometryHash: string | null;
  token: string;
}

/**
 * Contexte d'édition manuelle reconstruit ENTIÈREMENT depuis la base :
 * panneau, révision, dimensions, règles et version de moteur proviennent de
 * l'implantation enregistrée. Le navigateur ne peut pas les choisir.
 */
async function loadManualContext(
  sb: SB,
  companyId: string,
  modelId: string,
): Promise<ManualServerContext> {
  const model = await loadModelScoped(sb, companyId, modelId);
  const { data: arrays } = await sb
    .from("solar_arrays")
    .select("*")
    .eq("model_id", modelId)
    .eq("company_id", companyId)
    .order("created_at");
  if (!arrays?.length) throw new Error(NO_LAYOUT_MESSAGE);

  const planeIds = [
    ...new Set(arrays.map((a) => a.roof_plane_id).filter((id): id is string => !!id)),
  ];
  if (!planeIds.length) throw new Error(NO_LAYOUT_MESSAGE);

  // P0-D.1 : on ne choisit JAMAIS arbitrairement le premier champ. Si les
  // champs n'utilisent pas exactement le même panneau, les mêmes règles et le
  // même moteur, l'édition manuelle est refusée.
  assertManualArraysCompatible(arrays as unknown as ManualArrayRef[]);

  const main = arrays[0]!;
  const parsedSnapshot = StoredSnapshotSchema.safeParse(main.module_snapshot);
  if (!parsedSnapshot.success) throw new Error(MISSING_DIMENSIONS_MESSAGE);
  const stored = parsedSnapshot.data;
  const snapshot: ModuleSnapshot = {
    variant_id: stored.variant_id,
    revision_id: stored.revision_id ?? null,
    manufacturer: stored.manufacturer ?? "",
    series: stored.series ?? "",
    model: stored.model ?? "",
    power_wc: stored.power_wc,
    width_mm: stored.width_mm,
    height_mm: stored.height_mm,
    depth_mm: stored.depth_mm ?? null,
    weight_kg: stored.weight_kg ?? null,
    confidence: (stored.confidence as ModuleSnapshot["confidence"]) ?? "a_verifier",
    source: stored.source ?? null,
  };
  const spec: LayoutModuleSpec = {
    id: stored.variant_id,
    width_mm: stored.width_mm,
    height_mm: stored.height_mm,
    power_wc: stored.power_wc,
  };

  // Règles réellement appliquées à l'implantation, telles qu'enregistrées.
  const storedRules = (main.params as { rules?: unknown } | null)?.rules;
  const parsedRules = RulesInputSchema.partial().safeParse(storedRules ?? {});
  const rules: RulesProfile = {
    ...EMPTY_RULES_PROFILE,
    ...(parsedRules.success ? parsedRules.data : {}),
    version: main.rules_profile_version ?? 1,
  } as RulesProfile;
  const rulesProfileId = main.rules_profile_id ?? null;

  const { planes, idByKey, nameByKey } = await loadPlanes(sb, companyId, modelId, planeIds);
  const keyById = new Map([...idByKey].map(([k, id]) => [id, k]));

  const { data: placed } = await sb
    .from("solar_modules_placed")
    .select("*")
    .eq("model_id", modelId)
    .eq("company_id", companyId);

  const modules: LayoutModule[] = (placed ?? [])
    .map((m) => ({
      id: m.id,
      plane_key: keyById.get(m.roof_plane_id ?? "") ?? "",
      u: Number(m.local_u_m),
      v: Number(m.local_v_m),
      orientation: (m.orientation === "paysage"
        ? "paysage"
        : "portrait") as LayoutModule["orientation"],
      row: m.grid_row ?? 0,
      col: m.grid_col ?? 0,
      matrix: 0,
    }))
    .filter((m) => m.plane_key !== "");

  const token = manualContextToken({
    geometry_version: model.geometry_version,
    geometry_hash: model.geometry_hash ?? null,
    module: {
      variant_id: snapshot.variant_id,
      revision_id: snapshot.revision_id ?? null,
      width_mm: snapshot.width_mm,
      height_mm: snapshot.height_mm,
      depth_mm: snapshot.depth_mm ?? null,
      power_wc: snapshot.power_wc,
      manufacturer: snapshot.manufacturer,
      model: snapshot.model,
    },
    rules_profile_id: rulesProfileId,
    rules_profile_version: rules.version,
    rules,
    engine_version: LAYOUT_ENGINE_VERSION,
    plane_ids: planeIds,
  });

  return {
    planes,
    idByKey,
    nameByKey,
    spec,
    snapshot,
    rules,
    rulesProfileId,
    modules,
    geometryVersion: model.geometry_version,
    geometryHash: model.geometry_hash ?? null,
    token,
  };
}

/** Ouvre l'édition manuelle : état enregistré, règles réelles et jeton. */
export const getManualEditContext = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => BaseSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertSolarMember(supabase, data.companyId, userId);
    const ctx = await loadManualContext(supabase, data.companyId, data.modelId);
    return {
      geometry_version: ctx.geometryVersion,
      geometry_hash: ctx.geometryHash,
      manual_token: ctx.token,
      planes: ctx.planes,
      plane_names: Object.fromEntries(ctx.nameByKey),
      module_spec: ctx.spec,
      module_snapshot: ctx.snapshot,
      rules: ctx.rules,
      rules_profile_id: ctx.rulesProfileId,
      engine_version: LAYOUT_ENGINE_VERSION,
      modules: ctx.modules,
      validity: validateLayout(ctx.planes, ctx.modules, ctx.spec, ctx.rules),
    };
  });

/**
 * Enregistre une implantation corrigée à la main.
 * Le client envoie UNIQUEMENT des positions : panneau, révision, snapshot et
 * règles sont rechargés depuis l'implantation existante, puis TOUS les
 * panneaux sont revalidés. Un seul panneau invalide = refus complet.
 */
export const applyManualLayout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => ManualSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertSolarManage(supabase, data.companyId, userId);

    const ctx = await loadManualContext(supabase, data.companyId, data.modelId);
    // Refus non géométriques : version de toiture, jeton, pans, bornes.
    const refusal = manualGuardFailure(
      {
        geometryVersion: ctx.geometryVersion,
        token: ctx.token,
        planeKeys: [...ctx.idByKey.keys()],
      },
      data,
    );
    if (refusal) throw new Error(refusal);

    const modules: LayoutModule[] = data.modules.map((m) => ({ ...m }));
    const validity = validateLayout(ctx.planes, modules, ctx.spec, ctx.rules);
    const invalidMessage = manualInvalidMessage(validity.filter((v) => v.status !== "valid"));
    if (invalidMessage) throw new Error(invalidMessage);

    await writeLayout(supabase, {
      companyId: data.companyId,
      modelId: data.modelId,
      geometryVersion: data.geometryVersion,
      modules,
      planes: ctx.planes,
      spec: ctx.spec,
      rules: ctx.rules,
      idByKey: ctx.idByKey,
      snapshot: ctx.snapshot,
      rulesProfileId: ctx.rulesProfileId,
      // Une correction manuelle ne crée jamais de variante automatique.
      variant: null,
    });

    const summary = await refreshSummary(supabase, data.companyId, data.modelId, userId);
    return { summary, validity, geometry_version: ctx.geometryVersion };
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
  /** Variante éventuelle : écrite DANS la même transaction que l'implantation. */
  variant: ApplyVariantPayload | null;
}

async function writeLayout(sb: SB, args: WriteArgs): Promise<{ variantId: string | null }> {
  const arrays = buildArrayPayloads({
    planes: args.planes,
    modules: args.modules,
    spec: args.spec,
    rules: args.rules,
    idByKey: args.idByKey,
    snapshot: args.snapshot,
    rulesProfileId: args.rulesProfileId,
  });

  const rpcArgs = applyLayoutRpcArgs({
    companyId: args.companyId,
    modelId: args.modelId,
    geometryVersion: args.geometryVersion,
    arrays,
    variant: args.variant,
  });
  // Mêmes règles que la transaction SQL : on n'envoie jamais une charge
  // utile que la base refuserait, et la version de toiture est obligatoire.
  assertApplyRpcArgs(rpcArgs);

  const { data, error } = await sb.rpc("solar_apply_layout", rpcArgs as never);
  if (error) {
    if (error.message.includes("stale_geometry_version")) {
      throw new Error(
        "Le bâtiment a été modifié entre-temps. Rechargez la page avant d'enregistrer.",
      );
    }
    throw new Error("Enregistrement de l'implantation impossible.");
  }
  const variantId = (data as { variant_id?: string | null } | null)?.variant_id ?? null;
  return { variantId };
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

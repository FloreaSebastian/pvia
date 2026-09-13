/**
 * PVIA Module Database — fonctions serveur du catalogue de panneaux.
 *
 * Lecture : tout membre de l'entreprise (modules globaux + modules privés).
 * Écriture d'un module d'entreprise : rôle de gestion.
 * Aucune donnée n'est inventée : une valeur absente reste absente.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertSolarManage, assertSolarMember } from "@/lib/solar.server";
import {
  normalizeModuleText,
  validateCustomModule,
  type ModuleConfidence,
  type ModuleListItem,
  type ModuleStatus,
} from "@/lib/solar/module-catalog";

type SB = Parameters<typeof assertSolarMember>[0];

const VARIANT_SELECT = `
  id, model, model_original, pmax_stc_w, efficiency_pct, status, confidence, primary_source,
  source_ref, company_id, voc_v, vmp_v, isc_a, imp_a, max_system_voltage_v, max_series_fuse_a,
  temp_coeff_pmax_pct_per_c, temp_coeff_voc_pct_per_c, temp_coeff_isc_pct_per_c, noct_c,
  warranty_product_years, warranty_performance_years, certifications, verified_at, current_revision_id,
  series:solar_module_series!inner(
    id, name, model_family, width_mm, height_mm, depth_mm, weight_kg, technologies, cell_count,
    bifacial, frame_color, glass_type,
    manufacturer:solar_manufacturers!inner(id, name, country, website, logo_url)
  )
`;

type VariantRow = {
  id: string;
  model: string;
  model_original: string | null;
  pmax_stc_w: number | null;
  efficiency_pct: number | null;
  status: string | null;
  confidence: string | null;
  primary_source: string | null;
  source_ref: string | null;
  company_id: string | null;
  current_revision_id: string | null;
  series: {
    id: string;
    name: string;
    width_mm: number | null;
    height_mm: number | null;
    depth_mm: number | null;
    weight_kg: number | null;
    technologies: string[] | null;
    manufacturer: { id: string; name: string };
  };
};

function toListItem(
  row: VariantRow,
  fav: { is_favorite: boolean; last_used_at: string | null } | undefined,
): ModuleListItem {
  return {
    variant_id: row.id,
    manufacturer: row.series.manufacturer.name,
    manufacturer_id: row.series.manufacturer.id,
    series_id: row.series.id,
    series: row.series.name,
    model: row.model,
    power_wc: row.pmax_stc_w ?? 0,
    width_mm: row.series.width_mm,
    height_mm: row.series.height_mm,
    depth_mm: row.series.depth_mm,
    weight_kg: row.series.weight_kg,
    efficiency_pct: row.efficiency_pct,
    technologies: row.series.technologies ?? [],
    status: (row.status as ModuleStatus) ?? "UNKNOWN",
    confidence: (row.confidence as ModuleConfidence) ?? "to_verify",
    source: row.primary_source,
    is_company: row.company_id !== null,
    is_favorite: fav?.is_favorite ?? false,
    last_used_at: fav?.last_used_at ?? null,
  };
}

async function favoritesMap(sb: SB, companyId: string) {
  const { data } = await sb
    .from("solar_module_favorites")
    .select("module_variant_id, is_favorite, last_used_at")
    .eq("company_id", companyId);
  const map = new Map<string, { is_favorite: boolean; last_used_at: string | null }>();
  for (const f of data ?? []) {
    if (!f.module_variant_id) continue;
    map.set(f.module_variant_id, { is_favorite: f.is_favorite, last_used_at: f.last_used_at });
  }
  return map;
}

/* --------------------------------- Recherche -------------------------------- */

const SearchSchema = z.object({
  companyId: z.string().uuid(),
  query: z.string().max(120).default(""),
  manufacturerId: z.string().uuid().nullable().optional(),
  minPower: z.number().int().min(0).max(2000).nullable().optional(),
  maxPower: z.number().int().min(0).max(2000).nullable().optional(),
  withDimensionsOnly: z.boolean().default(true),
  companyOnly: z.boolean().default(false),
  page: z.number().int().min(0).max(500).default(0),
  pageSize: z.number().int().min(10).max(50).default(20),
});

export const searchModules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => SearchSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertSolarMember(supabase, data.companyId, userId);

    let q = supabase
      .from("solar_module_variants")
      .select(VARIANT_SELECT, { count: "estimated" })
      .or(`company_id.is.null,company_id.eq.${data.companyId}`);

    for (const term of normalizeModuleText(data.query).split(" ").filter(Boolean).slice(0, 5)) {
      q = q.ilike("search_text", `%${term}%`);
    }
    if (data.manufacturerId) q = q.eq("series.manufacturer_id", data.manufacturerId);
    if (data.minPower) q = q.gte("pmax_stc_w", data.minPower);
    if (data.maxPower) q = q.lte("pmax_stc_w", data.maxPower);
    if (data.withDimensionsOnly) {
      q = q.not("series.width_mm", "is", null).not("series.height_mm", "is", null);
    }
    if (data.companyOnly) q = q.eq("company_id", data.companyId);

    const from = data.page * data.pageSize;
    const { data: rows, count, error } = await q
      .order("pmax_stc_w", { ascending: false })
      .range(from, from + data.pageSize - 1);
    if (error) throw new Error("Recherche du catalogue impossible.");

    const favs = await favoritesMap(supabase, data.companyId);
    const items = ((rows ?? []) as unknown as VariantRow[]).map((r) => toListItem(r, favs.get(r.id)));
    return { items, total: count ?? items.length, page: data.page, pageSize: data.pageSize };
  });

export const listModuleManufacturers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertSolarMember(supabase, data.companyId, userId);
    const { data: rows } = await supabase
      .from("solar_manufacturers")
      .select("id, name, country, logo_url")
      .eq("is_active", true)
      .order("name")
      .limit(500);
    return rows ?? [];
  });

/** Panneaux mis en favori, panneaux récemment utilisés, panneau par défaut. */
export const getModuleShortlist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertSolarMember(supabase, data.companyId, userId);

    const [{ data: favRows }, { data: settings }] = await Promise.all([
      supabase
        .from("solar_module_favorites")
        .select("module_variant_id, is_favorite, last_used_at")
        .eq("company_id", data.companyId)
        .not("module_variant_id", "is", null)
        .order("last_used_at", { ascending: false, nullsFirst: false })
        .limit(40),
      supabase
        .from("company_settings")
        .select("default_module_variant_id")
        .eq("company_id", data.companyId)
        .maybeSingle(),
    ]);

    const ids = (favRows ?? []).map((f) => f.module_variant_id!).filter(Boolean);
    const defaultId = settings?.default_module_variant_id ?? null;
    if (defaultId && !ids.includes(defaultId)) ids.push(defaultId);
    if (!ids.length) return { favorites: [], recents: [], defaultVariantId: null as string | null };

    const { data: rows } = await supabase
      .from("solar_module_variants")
      .select(VARIANT_SELECT)
      .in("id", ids);

    const favs = await favoritesMap(supabase, data.companyId);
    const items = ((rows ?? []) as unknown as VariantRow[]).map((r) => toListItem(r, favs.get(r.id)));
    const byId = new Map(items.map((i) => [i.variant_id, i]));

    return {
      favorites: items.filter((i) => i.is_favorite),
      recents: (favRows ?? [])
        .map((f) => byId.get(f.module_variant_id!))
        .filter((i): i is ModuleListItem => Boolean(i && i.last_used_at))
        .slice(0, 8),
      defaultVariantId: defaultId,
    };
  });

/** Fiche rapide : caractéristiques, provenance par champ, conflits ouverts. */
export const getModuleDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid(), variantId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertSolarMember(supabase, data.companyId, userId);

    const { data: row } = await supabase
      .from("solar_module_variants")
      .select(VARIANT_SELECT)
      .eq("id", data.variantId)
      .maybeSingle();
    if (!row) throw new Error("Référence introuvable dans le catalogue.");

    const [{ data: sources }, { data: conflicts }, { data: revisions }] = await Promise.all([
      supabase
        .from("solar_module_field_sources")
        .select("field, value_text, source_type, source_label, source_url, retrieved_at, confidence")
        .eq("variant_id", data.variantId),
      supabase
        .from("solar_module_conflicts")
        .select("field, value_a, source_a, value_b, source_b, status")
        .eq("variant_id", data.variantId)
        .eq("status", "open"),
      supabase
        .from("solar_module_revisions")
        .select("id, revision_number, label, width_mm, height_mm, depth_mm, pmax_stc_w, datasheet_url, datasheet_date, is_current, created_at")
        .eq("variant_id", data.variantId)
        .order("revision_number", { ascending: false })
        .limit(10),
    ]);

    const favs = await favoritesMap(supabase, data.companyId);
    const variant = row as unknown as VariantRow & Record<string, unknown>;
    return {
      item: toListItem(variant, favs.get(variant.id)),
      electrical: {
        voc_v: variant["voc_v"] ?? null,
        vmp_v: variant["vmp_v"] ?? null,
        isc_a: variant["isc_a"] ?? null,
        imp_a: variant["imp_a"] ?? null,
        max_system_voltage_v: variant["max_system_voltage_v"] ?? null,
        max_series_fuse_a: variant["max_series_fuse_a"] ?? null,
        temp_coeff_pmax_pct_per_c: variant["temp_coeff_pmax_pct_per_c"] ?? null,
        temp_coeff_voc_pct_per_c: variant["temp_coeff_voc_pct_per_c"] ?? null,
        temp_coeff_isc_pct_per_c: variant["temp_coeff_isc_pct_per_c"] ?? null,
        noct_c: variant["noct_c"] ?? null,
      },
      sources: sources ?? [],
      conflicts: conflicts ?? [],
      revisions: revisions ?? [],
    };
  });

/* -------------------------------- Favoris --------------------------------- */

export const setModuleFavorite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({ companyId: z.string().uuid(), variantId: z.string().uuid(), favorite: z.boolean() })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertSolarManage(supabase, data.companyId, userId);
    const { data: existing } = await supabase
      .from("solar_module_favorites")
      .select("id")
      .eq("company_id", data.companyId)
      .eq("module_variant_id", data.variantId)
      .maybeSingle();
    if (existing) {
      await supabase
        .from("solar_module_favorites")
        .update({ is_favorite: data.favorite })
        .eq("id", existing.id);
    } else if (data.favorite) {
      await supabase
        .from("solar_module_favorites")
        .insert({ company_id: data.companyId, module_variant_id: data.variantId, is_favorite: true });
    }
    return { favorite: data.favorite };
  });

export const setDefaultModule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ companyId: z.string().uuid(), variantId: z.string().uuid().nullable() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertSolarManage(supabase, data.companyId, userId);
    const { error } = await supabase
      .from("company_settings")
      .update({ default_module_variant_id: data.variantId })
      .eq("company_id", data.companyId);
    if (error) throw new Error("Enregistrement du panneau par défaut impossible.");
    return { ok: true };
  });

/* -------------------------- Module propre à l'entreprise ------------------- */

const CustomSchema = z.object({
  companyId: z.string().uuid(),
  manufacturer: z.string().min(2).max(80),
  model: z.string().min(2).max(120),
  power_wc: z.number().int(),
  width_mm: z.number().int(),
  height_mm: z.number().int(),
  depth_mm: z.number().int().nullable().optional(),
  weight_kg: z.number().nullable().optional(),
  datasheet_url: z.string().url().max(500).nullable().optional(),
});

export const createCustomModule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => CustomSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertSolarManage(supabase, data.companyId, userId);

    const errors = validateCustomModule({
      manufacturer: data.manufacturer,
      model: data.model,
      power_wc: data.power_wc,
      width_mm: data.width_mm,
      height_mm: data.height_mm,
      depth_mm: data.depth_mm ?? null,
      weight_kg: data.weight_kg ?? null,
    });
    if (errors.length) throw new Error(errors.join(" "));

    const normalized = normalizeModuleText(data.manufacturer);
    const { data: existingMaker } = await supabase
      .from("solar_manufacturers")
      .select("id")
      .eq("name_normalized", normalized)
      .maybeSingle();

    let manufacturerId = existingMaker?.id ?? null;
    if (!manufacturerId) {
      const { data: created, error } = await supabase
        .from("solar_manufacturers")
        .insert({ name: data.manufacturer.trim(), name_normalized: normalized })
        .select("id")
        .single();
      if (error) throw new Error("Création du fabricant impossible.");
      manufacturerId = created.id;
    }

    const seriesName = `${data.model.trim()} (${data.width_mm}×${data.height_mm} mm)`;
    const { data: series, error: seriesErr } = await supabase
      .from("solar_module_series")
      .insert({
        manufacturer_id: manufacturerId,
        company_id: data.companyId,
        name: seriesName,
        name_normalized: normalizeModuleText(seriesName),
        width_mm: data.width_mm,
        height_mm: data.height_mm,
        depth_mm: data.depth_mm ?? null,
        weight_kg: data.weight_kg ?? null,
        created_by: userId,
      })
      .select("id")
      .single();
    if (seriesErr) throw new Error("Création de la série impossible.");

    const { data: variant, error: variantErr } = await supabase
      .from("solar_module_variants")
      .insert({
        series_id: series.id,
        company_id: data.companyId,
        model: data.model.trim(),
        model_original: data.model.trim(),
        model_normalized: normalizeModuleText(data.model),
        pmax_stc_w: data.power_wc,
        status: "ACTIVE",
        confidence: "company",
        primary_source: "Saisie entreprise",
        search_text: normalizeModuleText(`${data.manufacturer} ${data.model} ${data.power_wc}`),
        created_by: userId,
      })
      .select("id")
      .single();
    if (variantErr) throw new Error("Création de la référence impossible.");

    const { data: revision } = await supabase
      .from("solar_module_revisions")
      .insert({
        variant_id: variant.id,
        revision_number: 1,
        label: "Saisie initiale",
        width_mm: data.width_mm,
        height_mm: data.height_mm,
        depth_mm: data.depth_mm ?? null,
        weight_kg: data.weight_kg ?? null,
        pmax_stc_w: data.power_wc,
        datasheet_url: data.datasheet_url ?? null,
        source_type: "company",
        is_current: true,
        created_by: userId,
      })
      .select("id")
      .single();

    if (revision) {
      await supabase
        .from("solar_module_variants")
        .update({ current_revision_id: revision.id })
        .eq("id", variant.id);
    }

    await supabase
      .from("solar_module_favorites")
      .insert({ company_id: data.companyId, module_variant_id: variant.id, is_favorite: true });

    return { variantId: variant.id };
  });

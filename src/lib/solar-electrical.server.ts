/**
 * Solar Studio P2-A — chargement serveur du contexte électrique (RLS utilisateur).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { planeGeometryFromRow } from "@/lib/solar.server";
import {
  inverterSpecFromRows,
  moduleElectricalFromRow,
  moduleKey,
  type DesignSummary,
  type ElecCheck,
  type ElecGroup,
  type ElecModule,
  type InverterSpec,
  type ModuleElectrical,
  type StoredElectricalDesign,
} from "@/lib/solar-electrical";

type SB = SupabaseClient<Database>;
// Tables ajoutées en P2-A : accès non typé tant que les types générés ne sont pas relus.
type Loose = { from: (t: string) => any; rpc: (f: string, a: Record<string, unknown>) => any };

export interface ElectricalContext {
  geometry_version: number;
  layout_version: number;
  layout_hash: string;
  geometry_hash: string | null;
  modules: ElecModule[];
  electrical: Record<string, ModuleElectrical>;
  plane_order: string[];
  inverters: InverterSpec[];
}

export async function loadElectricalContext(
  sb: SB,
  companyId: string,
  modelId: string,
): Promise<ElectricalContext> {
  const l = sb as unknown as Loose;
  const { data: model, error } = await l
    .from("solar_models")
    .select("id, geometry_version, layout_version")
    .eq("id", modelId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error || !model) throw new Error("model_not_found");

  const [hash, geo, planes, arrays, modules, invs, revs] = await Promise.all([
    l.rpc("solar_layout_fingerprint", { _company_id: companyId, _model_id: modelId }),
    l.rpc("solar_geometry_fingerprint", { _company_id: companyId, _model_id: modelId }),
    sb
      .from("solar_roof_planes")
      .select("*")
      .eq("model_id", modelId)
      .eq("company_id", companyId)
      .order("name"),
    sb
      .from("solar_arrays")
      .select("id, roof_plane_id, module_variant_id, module_revision_id, module_snapshot")
      .eq("model_id", modelId)
      .eq("company_id", companyId),
    sb
      .from("solar_modules_placed")
      .select("id, array_id, roof_plane_id, local_u_m, local_v_m, orientation, enabled")
      .eq("model_id", modelId)
      .eq("company_id", companyId),
    l
      .from("solar_inverters")
      .select("*")
      .eq("archived", false)
      .or(`company_id.is.null,company_id.eq.${companyId}`),
    l
      .from("solar_inverter_revisions")
      .select("*")
      .eq("is_current", true)
      .or(`company_id.is.null,company_id.eq.${companyId}`),
  ]);
  if (hash.error || !hash.data) throw new Error("layout_hash_unavailable");

  const planeRows = planes.data ?? [];
  const planeInfo = new Map(
    planeRows.map((p) => {
      const g = planeGeometryFromRow(p);
      return [p.id, { key: g?.key ?? p.id, name: p.name ?? "Pan" }];
    }),
  );
  const arrayRows = arrays.data ?? [];
  const variantIds = [
    ...new Set(arrayRows.map((a) => a.module_variant_id).filter(Boolean)),
  ] as string[];
  const variants = variantIds.length
    ? await sb.from("solar_module_variants").select("*").in("id", variantIds)
    : { data: [] as Record<string, unknown>[] };
  const variantById = new Map(
    (variants.data ?? []).map((v) => [
      String((v as { id: string }).id),
      v as Record<string, unknown>,
    ]),
  );

  const electrical: Record<string, ModuleElectrical> = {};
  const keyByArray = new Map<string, string | null>();
  for (const a of arrayRows) {
    const v = a.module_variant_id ? variantById.get(a.module_variant_id) : undefined;
    if (!v) {
      keyByArray.set(a.id, null);
      continue;
    }
    const el = moduleElectricalFromRow(
      v,
      a.module_revision_id ?? null,
      (a.module_snapshot ?? null) as Record<string, unknown> | null,
    );
    electrical[el.key] = el;
    keyByArray.set(a.id, moduleKey(el.variant_id, el.revision_id));
  }

  const elecModules: ElecModule[] = (modules.data ?? [])
    .filter((m) => m.enabled)
    .map((m) => {
      const p = planeInfo.get(m.roof_plane_id ?? "") ?? { key: "", name: "Pan" };
      return {
        id: m.id,
        plane_key: p.key,
        plane_name: p.name,
        orientation: m.orientation === "paysage" ? "paysage" : "portrait",
        module_key: m.array_id ? (keyByArray.get(m.array_id) ?? null) : null,
        u: Number(m.local_u_m),
        v: Number(m.local_v_m),
      } as ElecModule;
    })
    .sort((a, b) => (a.id < b.id ? -1 : 1));

  const revByInv = new Map<string, Record<string, unknown>>();
  for (const r of (revs.data ?? []) as Record<string, unknown>[])
    revByInv.set(String(r.inverter_id), r);
  const inverters = ((invs.data ?? []) as Record<string, unknown>[])
    .filter((i) => revByInv.has(String(i.id)))
    .map((i) => inverterSpecFromRows(i, revByInv.get(String(i.id))!))
    .sort((a, b) => `${a.manufacturer} ${a.model}`.localeCompare(`${b.manufacturer} ${b.model}`));

  return {
    geometry_version: Number(model.geometry_version),
    layout_version: Number(model.layout_version ?? 0),
    layout_hash: String(hash.data),
    geometry_hash: geo?.data ? String(geo.data) : null,
    modules: elecModules,
    electrical,
    plane_order: planeRows.map((p) => planeInfo.get(p.id)!.key),
    inverters,
  };
}

export async function loadCurrentDesign(
  sb: SB,
  companyId: string,
  modelId: string,
): Promise<StoredElectricalDesign | null> {
  const l = sb as unknown as Loose;
  const { data: design } = await l
    .from("solar_electrical_designs")
    .select("*")
    .eq("model_id", modelId)
    .eq("company_id", companyId)
    .eq("is_current", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!design) return null;
  const [strings, assigns] = await Promise.all([
    l.from("solar_electrical_strings").select("*").eq("design_id", design.id).order("position"),
    l
      .from("solar_electrical_assignments")
      .select("string_id, module_id, position")
      .eq("design_id", design.id)
      .order("position"),
  ]);
  const byString = new Map<string, string[]>();
  for (const a of (assigns.data ?? []) as { string_id: string; module_id: string }[]) {
    byString.set(a.string_id, [...(byString.get(a.string_id) ?? []), a.module_id]);
  }
  return {
    id: String(design.id),
    topology: design.topology as string,
    status: design.status as string,
    inverter_snapshot: design.inverter_snapshot as InverterSpec,
    inverter_count: Number(design.inverter_count),
    temp_min_c: Number(design.temp_min_c),
    temp_max_c: Number(design.temp_max_c),
    temp_source: String(design.temp_source),
    geometry_version: Number(design.geometry_version),
    layout_version: Number(design.layout_version),
    layout_hash: String(design.layout_hash),
    engine_version: String(design.engine_version),
    variant_label: design.variant_label as string | null,
    summary: design.summary as DesignSummary,
    warnings: design.warnings as ElecCheck[],
    created_at: String(design.created_at),
    groups: ((strings.data ?? []) as Record<string, unknown>[]).map(
      (s): ElecGroup => ({
        id: String(s.id),
        kind: s.kind === "micro" ? "micro" : "string",
        label: String(s.label),
        inverter_index: Number(s.inverter_index),
        mppt_index: s.mppt_index == null ? null : Number(s.mppt_index),
        module_ids: byString.get(String(s.id)) ?? [],
      }),
    ),
  };
}

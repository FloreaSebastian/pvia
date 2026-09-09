/**
 * Solar Studio — helpers serveur (droits, géométrie persistée).
 * Importé uniquement par src/lib/solar.functions.ts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { buildRoofPlanes } from "./solar/roof";
import type { BuildingParams, RoofPlaneGeometry } from "./solar/types";
import { DEFAULT_BUILDING_PARAMS } from "./solar/types";

type SB = SupabaseClient<Database>;

export type SolarModelRow = Database["public"]["Tables"]["solar_models"]["Row"];
export type SolarBuildingRow = Database["public"]["Tables"]["solar_buildings"]["Row"];
export type SolarRoofPlaneRow = Database["public"]["Tables"]["solar_roof_planes"]["Row"];

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

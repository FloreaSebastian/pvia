/**
 * Solar Studio — synthèse du modèle.
 *
 * Module PUR. Les valeurs produites sont géométriques (comptage, puissance
 * crête, surfaces). Aucune production annuelle n'est estimée ici : elle
 * dépend d'un fournisseur d'irradiation, traité dans une phase ultérieure.
 */
import { moduleFootprint } from "./layout";
import type { PlacedModule, RoofPlaneGeometry, SolarModuleSpec, SolarQualityLevel, SolarSummary } from "./types";

export function computeSolarSummary(
  planes: RoofPlaneGeometry[],
  modules: PlacedModule[],
  spec: Pick<SolarModuleSpec, "power_wc" | "width_mm" | "height_mm"> | null,
  qualityLevel: SolarQualityLevel,
): SolarSummary {
  const active = modules.filter((m) => m.enabled);
  const roofArea = planes.reduce((sum, p) => sum + p.area_m2, 0);

  let moduleArea = 0;
  if (spec) {
    for (const m of active) {
      const f = moduleFootprint(spec, m.orientation);
      moduleArea += f.width * f.length;
    }
  }

  // Pan portant le plus de modules : c'est lui qui caractérise l'installation.
  const counts = new Map<string, number>();
  for (const m of active) counts.set(m.roof_plane_key, (counts.get(m.roof_plane_key) ?? 0) + 1);
  let mainKey: string | null = null;
  let best = 0;
  for (const [key, n] of counts) {
    if (n > best) {
      best = n;
      mainKey = key;
    }
  }
  const mainPlane = planes.find((p) => p.key === mainKey) ?? null;

  return {
    module_count: active.length,
    power_kwc: spec ? Math.round(((active.length * spec.power_wc) / 1000) * 100) / 100 : 0,
    module_area_m2: Math.round(moduleArea * 10) / 10,
    roof_area_m2: Math.round(roofArea * 10) / 10,
    coverage_pct: roofArea > 0 ? Math.round((moduleArea / roofArea) * 1000) / 10 : 0,
    main_azimuth_deg: mainPlane ? Math.round(mainPlane.azimuth_deg) : null,
    main_tilt_deg: mainPlane ? Math.round(mainPlane.tilt_deg) : null,
    quality_level: qualityLevel,
  };
}

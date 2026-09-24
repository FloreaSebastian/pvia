/**
 * Solar Studio V2 — P1.1 : sélection d'un panneau dans la vue 3D.
 *
 * Module PUR. Un clic sur un panneau en 3D est une SÉLECTION : il ne modifie
 * jamais le modèle (aucun activer/désactiver, aucun appel réseau).
 */
import { normalizeValidityStatus, type ModuleValidityStatus, type PlacedModule } from "./types";

export interface ModuleSelection {
  moduleId: string;
  planeKey: string;
}

/** Résout le panneau cliqué et son pan. `null` si l'identifiant est inconnu. */
export function resolveModuleSelection(
  modules: Pick<PlacedModule, "id" | "roof_plane_key">[],
  moduleId: string,
): ModuleSelection | null {
  const m = modules.find((x) => x.id === moduleId);
  return m ? { moduleId: m.id, planeKey: m.roof_plane_key } : null;
}

export interface SelectedModuleInfo {
  planeName: string;
  orientation: string;
  u: number;
  v: number;
  enabled: boolean;
  validity: ModuleValidityStatus;
  validityCause: string | null;
  panelLabel: string | null;
}

/** Informations affichées pour le panneau sélectionné (lecture seule). */
export function describeSelectedModule(
  input: {
    modules: PlacedModule[];
    planes: { key: string; name: string }[];
    panelLabelByPlaneKey?: Record<string, string | null>;
  },
  moduleId: string | null,
): SelectedModuleInfo | null {
  if (!moduleId) return null;
  const m = input.modules.find((x) => x.id === moduleId);
  if (!m) return null;
  return {
    planeName: input.planes.find((p) => p.key === m.roof_plane_key)?.name ?? m.roof_plane_key,
    orientation: m.orientation === "paysage" ? "Paysage" : "Portrait",
    u: Math.round(m.local_u_m * 100) / 100,
    v: Math.round(m.local_v_m * 100) / 100,
    enabled: m.enabled,
    validity: normalizeValidityStatus(m.validity_status),
    validityCause: m.validity_cause ?? null,
    panelLabel: input.panelLabelByPlaneKey?.[m.roof_plane_key] ?? null,
  };
}

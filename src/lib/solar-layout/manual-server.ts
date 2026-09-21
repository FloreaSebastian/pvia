/**
 * Solar Studio — contrat serveur de l'édition manuelle (P0-D.1).
 *
 * Module PUR et déterministe : aucune dépendance React, DOM ou réseau.
 * Il concentre les refus NON géométriques du chemin `applyManualLayout`
 * (homogénéité des champs, version de toiture, jeton, pans, bornes) afin
 * qu'ils soient testables sans écrire la moindre donnée client.
 *
 * La validation géométrique complète reste celle de P0-C
 * (`validateLayout` / `validateModuleAgainst`) : elle n'est pas dupliquée ici.
 */
import { fingerprint } from "@/lib/solar/hash";

/* ------------------- Homogénéité des champs de panneaux ------------------- */

export interface ManualArrayRef {
  module_variant_id: string | null;
  module_revision_id: string | null;
  module_snapshot: unknown;
  rules_profile_id: string | null;
  rules_profile_version: number | null;
  layout_engine_version: string | null;
  params?: unknown;
}

export const MULTI_CONFIG_MESSAGE =
  "Cette implantation contient plusieurs configurations de panneaux ou de règles. " +
  "Séparez les champs ou régénérez une implantation homogène avant l'édition manuelle.";

/** Partie du snapshot qui engage réellement la géométrie et la puissance. */
function canonicalSnapshot(snapshot: unknown): unknown {
  if (!snapshot || typeof snapshot !== "object") return null;
  const s = snapshot as Record<string, unknown>;
  return {
    variant_id: s["variant_id"] ?? null,
    revision_id: s["revision_id"] ?? null,
    manufacturer: s["manufacturer"] ?? null,
    model: s["model"] ?? null,
    series: s["series"] ?? null,
    power_wc: s["power_wc"] ?? null,
    width_mm: s["width_mm"] ?? null,
    height_mm: s["height_mm"] ?? null,
    depth_mm: s["depth_mm"] ?? null,
  };
}

/** Règles réellement appliquées, telles qu'enregistrées dans `params.rules`. */
function canonicalRules(params: unknown): unknown {
  if (!params || typeof params !== "object") return null;
  return (params as { rules?: unknown }).rules ?? null;
}

/** Empreinte de configuration d'un champ : panneau + règles + moteur. */
export function manualArrayConfigKey(a: ManualArrayRef): string {
  return fingerprint({
    module_variant_id: a.module_variant_id ?? null,
    module_revision_id: a.module_revision_id ?? null,
    module_snapshot: canonicalSnapshot(a.module_snapshot),
    rules_profile_id: a.rules_profile_id ?? null,
    rules_profile_version: a.rules_profile_version ?? null,
    rules: canonicalRules(a.params),
    layout_engine_version: a.layout_engine_version ?? null,
  });
}

/** Tous les champs partagent-ils exactement panneau, règles et moteur ? */
export function manualArraysCompatible(arrays: readonly ManualArrayRef[]): boolean {
  if (arrays.length <= 1) return true;
  const first = manualArrayConfigKey(arrays[0]!);
  return arrays.every((a) => manualArrayConfigKey(a) === first);
}

/**
 * Refuse l'entrée en édition manuelle dès qu'un champ diverge : on ne choisit
 * JAMAIS arbitrairement `arrays[0]` comme référence implicite.
 */
export function assertManualArraysCompatible(arrays: readonly ManualArrayRef[]): void {
  if (!manualArraysCompatible(arrays)) throw new Error(MULTI_CONFIG_MESSAGE);
}

/* ------------------------ Refus non géométriques -------------------------- */

export const MANUAL_MAX_MODULES = 2000;
export const MANUAL_MAX_ARRAYS = 12;
export const MANUAL_COORD_LIMIT_M = 2000;

export const MANUAL_STALE_GEOMETRY_MESSAGE =
  "La toiture a été modifiée depuis l'ouverture de l'édition. Rechargez la page avant d'enregistrer.";
export const MANUAL_DRIFT_MESSAGE =
  "L'implantation ou la toiture a changé depuis l'ouverture de l'édition. Rechargez avant d'enregistrer.";
export const MANUAL_UNKNOWN_PLANE_MESSAGE = "Pan de toiture inconnu dans les modifications.";
export const MANUAL_EMPTY_MESSAGE = "Cette implantation ne contiendrait plus aucun panneau.";
export const MANUAL_TOO_MANY_MESSAGE = "Trop de panneaux dans cette implantation.";
export const MANUAL_BAD_POSITION_MESSAGE = "Position de panneau hors limites.";

export interface ManualGuardContext {
  geometryVersion: number;
  token: string;
  planeKeys: readonly string[];
}

export interface ManualGuardPayload {
  geometryVersion: number | null | undefined;
  manualToken: string | null | undefined;
  allowEmpty?: boolean;
  modules: readonly { plane_key: string; u: number; v: number }[];
}

/**
 * Renvoie le message de refus, ou `null` si la charge utile peut passer à la
 * revalidation géométrique. L'ordre des contrôles est stable et testable.
 */
export function manualGuardFailure(
  ctx: ManualGuardContext,
  payload: ManualGuardPayload,
): string | null {
  if (payload.geometryVersion === null || payload.geometryVersion === undefined) {
    return MANUAL_STALE_GEOMETRY_MESSAGE;
  }
  if (payload.geometryVersion !== ctx.geometryVersion) return MANUAL_STALE_GEOMETRY_MESSAGE;
  if (!payload.manualToken || payload.manualToken !== ctx.token) return MANUAL_DRIFT_MESSAGE;
  if (payload.modules.length > MANUAL_MAX_MODULES) return MANUAL_TOO_MANY_MESSAGE;
  if (payload.modules.length === 0 && !payload.allowEmpty) return MANUAL_EMPTY_MESSAGE;

  const known = new Set(ctx.planeKeys);
  for (const m of payload.modules) {
    if (!known.has(m.plane_key)) return MANUAL_UNKNOWN_PLANE_MESSAGE;
    for (const coord of [m.u, m.v]) {
      if (!Number.isFinite(coord) || Math.abs(coord) > MANUAL_COORD_LIMIT_M) {
        return MANUAL_BAD_POSITION_MESSAGE;
      }
    }
  }
  const planesUsed = new Set(payload.modules.map((m) => m.plane_key));
  if (planesUsed.size > MANUAL_MAX_ARRAYS) return MANUAL_TOO_MANY_MESSAGE;
  return null;
}

/** Message unique de refus géométrique, identique côté UI et serveur. */
export function manualInvalidMessage(
  invalid: readonly { message?: string | null }[],
): string | null {
  if (invalid.length === 0) return null;
  const first = invalid[0]?.message ?? "position interdite";
  return `${invalid.length} panneau${invalid.length > 1 ? "x" : ""} en position interdite : ${first}. Corrigez avant d'enregistrer.`;
}

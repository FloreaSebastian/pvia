/**
 * Smart PV Layout Engine — jeton de calcul.
 *
 * Module PUR. Le jeton fige TOUTES les entrées d'un calcul : toiture, panneau
 * (référence ET révision ET dimensions/puissance réellement utilisées), profil
 * de règles (identifiant, version ET contenu), version du moteur, pans dans
 * leur ordre de priorité, objectif, orientation et stratégies.
 *
 * La signature d'une variante ne décrit que des coordonnées : deux entrées
 * différentes peuvent aboutir aux mêmes positions. Le jeton, lui, refuse
 * l'application dès qu'une seule entrée a dérivé entre le calcul et l'écriture.
 */
import { fingerprint } from "@/lib/solar/hash";
import type { LayoutTarget, OrientationMode, RulesProfile, Strategy } from "./types";

/** Version du format de jeton : un changement invalide tous les jetons émis. */
export const COMPUTE_TOKEN_FORMAT = "pvia-layout-1";

export interface ComputeModuleRef {
  variant_id: string;
  revision_id: string | null;
  width_mm: number;
  height_mm: number;
  depth_mm: number | null;
  power_wc: number;
  manufacturer?: string | null;
  model?: string | null;
}

export interface ComputeContext {
  geometry_version: number;
  geometry_hash: string | null;
  module: ComputeModuleRef;
  rules_profile_id: string | null;
  rules_profile_version: number;
  /** Contenu réellement appliqué : une règle modifiée sans changer de version est détectée. */
  rules: RulesProfile;
  engine_version: string;
  /** Clés des pans, dans l'ordre de priorité demandé par l'utilisateur. */
  plane_priority: string[];
  target: LayoutTarget;
  orientation: OrientationMode;
  strategies?: Strategy[];
}

/** Empreinte du contexte de calcul, indépendante de la variante choisie. */
export function computeContextToken(ctx: ComputeContext): string {
  return `${COMPUTE_TOKEN_FORMAT}.${fingerprint({
    geometry_version: ctx.geometry_version,
    geometry_hash: ctx.geometry_hash ?? null,
    module: {
      variant_id: ctx.module.variant_id,
      revision_id: ctx.module.revision_id ?? null,
      width_mm: ctx.module.width_mm,
      height_mm: ctx.module.height_mm,
      depth_mm: ctx.module.depth_mm ?? null,
      power_wc: ctx.module.power_wc,
      manufacturer: ctx.module.manufacturer ?? null,
      model: ctx.module.model ?? null,
    },
    rules_profile_id: ctx.rules_profile_id ?? null,
    rules_profile_version: ctx.rules_profile_version,
    rules: ctx.rules,
    engine_version: ctx.engine_version,
    plane_priority: ctx.plane_priority,
    target: {
      mode: ctx.target.mode,
      power_kwc: ctx.target.power_kwc ?? null,
      count: ctx.target.count ?? null,
      rounding: ctx.target.rounding,
    },
    orientation: ctx.orientation,
    strategies: ctx.strategies?.length ? [...ctx.strategies] : null,
  })}`;
}

/** Jeton d'une variante précise : contexte + empreinte des positions. */
export function candidateToken(contextToken: string, signature: string): string {
  return `${contextToken}.${fingerprint(signature)}`;
}

/** Le jeton présenté correspond-il exactement au contexte et à la variante ? */
export function tokenMatches(token: string, ctx: ComputeContext, signature: string): boolean {
  return token === candidateToken(computeContextToken(ctx), signature);
}

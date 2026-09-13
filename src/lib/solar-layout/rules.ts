/**
 * Smart PV Layout Engine — profils de règles.
 *
 * Aucune distance n'est codée en dur dans le moteur : tout vient d'un profil
 * fourni par l'entreprise. Ce fichier ne propose qu'un profil « vide »
 * (toutes marges à zéro) servant de base à la saisie, jamais de valeur
 * réglementaire inventée.
 */
import type { RulesProfile } from "./types";

export const EMPTY_RULES_PROFILE: RulesProfile = {
  id: "vide",
  name: "Sans marge",
  version: 1,
  eave_m: 0,
  ridge_m: 0,
  verge_m: 0,
  valley_m: 0,
  hip_m: 0,
  obstacle_m: 0,
  row_gap_m: 0,
  col_gap_m: 0,
  walkway_m: 0,
};

export function makeRulesProfile(partial: Partial<RulesProfile>): RulesProfile {
  return { ...EMPTY_RULES_PROFILE, ...partial };
}

/** Empreinte stable d'un profil : permet de rejouer un ancien design. */
export function rulesFingerprint(p: RulesProfile): string {
  return [
    p.id,
    p.version,
    p.eave_m,
    p.ridge_m,
    p.verge_m,
    p.valley_m,
    p.hip_m,
    p.obstacle_m,
    p.row_gap_m,
    p.col_gap_m,
    p.walkway_m,
  ].join(":");
}

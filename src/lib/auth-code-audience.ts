/**
 * Contexte (audience) des codes de connexion à 6 chiffres.
 *
 * Les parcours professionnel et sous-traitant partagent la table
 * `enterprise_auth_codes`. Sans marqueur explicite, une même adresse valide
 * dans les deux contextes permettait de vérifier un code émis pour l'autre
 * parcours. Chaque écriture, invalidation et lecture est désormais filtrée par
 * ce champ, ET revérifiée en mémoire (défense en profondeur).
 *
 * Les lignes antérieures à la migration valent `professional` (valeur par
 * défaut en base), ce qui préserve le parcours professionnel existant.
 */
export const AUTH_CODE_AUDIENCES = ["professional", "subcontractor"] as const;

export type AuthCodeAudience = (typeof AUTH_CODE_AUDIENCES)[number];

/** Une ligne sans audience (donnée historique) est traitée comme professionnelle. */
export function rowAudience(row: { audience?: string | null } | null | undefined): AuthCodeAudience {
  const raw = row?.audience;
  return raw === "subcontractor" ? "subcontractor" : "professional";
}

/** Le code appartient-il RÉELLEMENT au parcours qui tente de le vérifier ? */
export function matchesAudience(
  row: { audience?: string | null } | null | undefined,
  expected: AuthCodeAudience,
): boolean {
  if (!row) return false;
  return rowAudience(row) === expected;
}

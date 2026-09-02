/**
 * Identité légale de l'éditeur affichée sur /mentions.
 *
 * IMPORTANT — aucune valeur ne doit être inventée.
 * Tant qu'un champ vaut `null`, la page affiche explicitement
 * « information à fournir par l'éditeur » au lieu d'un identifiant fictif.
 * Publier de faux numéros RCS / TVA / capital est une infraction
 * (art. 6-III LCEN et art. 441-1 du Code pénal).
 *
 * Le propriétaire doit renseigner ci-dessous les valeurs réelles issues
 * de l'extrait Kbis et de l'attestation de TVA intracommunautaire.
 */
export type LegalEntity = {
  /** Dénomination sociale exacte au Kbis. */
  legalName: string | null;
  /** Forme juridique (SAS, SARL, EI, micro-entreprise…). */
  legalForm: string | null;
  /** Capital social en euros, tel qu'inscrit au Kbis. */
  shareCapital: string | null;
  /** Adresse complète du siège social. */
  address: string | null;
  /** Ville et numéro RCS (ex. « Paris B 123 456 789 »). */
  rcs: string | null;
  /** SIREN / SIRET. */
  siret: string | null;
  /** Numéro de TVA intracommunautaire. */
  vatNumber: string | null;
  /** Nom du directeur de la publication (personne physique). */
  publicationDirector: string | null;
  /** Email de contact publié. */
  contactEmail: string;
};

export const LEGAL_ENTITY: LegalEntity = {
  legalName: null,
  legalForm: null,
  shareCapital: null,
  address: null,
  rcs: null,
  siret: null,
  vatNumber: null,
  publicationDirector: null,
  contactEmail: "contact@pvia.fr",
};

/** Champs obligatoires encore manquants (utilisé par /mentions et l'audit). */
export function missingLegalFields(entity: LegalEntity = LEGAL_ENTITY): string[] {
  const labels: Record<string, string> = {
    legalName: "Dénomination sociale",
    legalForm: "Forme juridique",
    shareCapital: "Capital social",
    address: "Adresse du siège social",
    rcs: "Ville et numéro RCS",
    siret: "SIREN / SIRET",
    vatNumber: "N° de TVA intracommunautaire",
    publicationDirector: "Directeur de la publication",
  };
  return Object.entries(labels)
    .filter(([key]) => !entity[key as keyof LegalEntity])
    .map(([, label]) => label);
}

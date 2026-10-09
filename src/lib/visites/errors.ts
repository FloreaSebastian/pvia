/** Traduction des erreurs métier remontées par les fonctions SQL des visites (jamais d'erreur brute). */
const MESSAGES: Record<string, string> = {
  VT_AUTH_REQUIRED: "Session expirée : reconnectez-vous.",
  VT_IDEMPOTENCY_REQUIRED: "Requête invalide : rechargez la page et réessayez.",
  VT_CLIENT_NOT_FOUND: "Client introuvable dans votre entreprise.",
  VT_CHANTIER_NOT_FOUND: "Chantier introuvable dans votre entreprise.",
  VT_CHANTIER_CLIENT_MISMATCH: "Ce chantier appartient à un autre client : choisissez un chantier du client sélectionné.",
  VT_ASSIGNEE_INVALID: "Le technicien choisi n'est pas un membre actif de votre entreprise.",
  VT_VISIT_NOT_FOUND: "Visite introuvable.",
  VT_PLAN_REQUIRED: "Les visites techniques sont incluses dans les offres Pro, Business et Entreprise.",
  VT_FORBIDDEN: "Seuls les responsables de l’entreprise peuvent créer ou planifier une visite.",
  VT_WRITE_LOCKED: "Abonnement inactif : modification impossible pour le moment.",
  VT_LOTS_REQUIRED: "Choisissez au moins un lot de travaux.",
  VT_LOTS_INVALID: "Lot de travaux non reconnu pour cette visite.",
  VT_VISIT_LOCKED: "Cette visite est terminée ou clôturée : ajout de lot impossible.",
  VT_LOTS_SHRINK: "Un lot ne peut pas être retiré d'une visite.",
  VT_VISIT_ARCHIVED: "Visite archivée : modification impossible.",
};

export function friendlyVisitDbError(raw: string | null | undefined, fallback: string): string {
  if (!raw) return fallback;
  const code = Object.keys(MESSAGES).find((k) => raw.includes(k));
  return code ? MESSAGES[code] : fallback;
}

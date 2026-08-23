/**
 * Traduit une erreur brute de l'envoyeur d'emails en message lisible.
 * Le détail technique reste disponible (title / repli), mais n'est plus
 * affiché tel quel dans l'historique des emails.
 */
export function friendlyEmailError(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = String(raw);
  const lower = text.toLowerCase();

  if (lower.includes("invalid `to` field") || lower.includes("testing email address")) {
    return "Adresse destinataire refusée par le service d'envoi (domaine de test non autorisé).";
  }
  if (lower.includes("invalid") && lower.includes("email")) {
    return "Adresse email invalide.";
  }
  if (lower.includes("rate") && lower.includes("limit")) {
    return "Trop d'envois en peu de temps : l'email sera réessayé automatiquement.";
  }
  if (lower.includes("domain") && (lower.includes("verify") || lower.includes("not verified"))) {
    return "Domaine d'envoi non vérifié.";
  }
  if (lower.includes("bounce") || lower.includes("mailbox") || lower.includes("recipient")) {
    return "Le destinataire a refusé l'email (boîte inexistante ou pleine).";
  }
  if (/^\s*(4\d\d|5\d\d)\b/.test(text) || lower.includes("timeout") || lower.includes("network")) {
    return "Échec temporaire du service d'envoi. L'email sera réessayé.";
  }
  return "L'envoi a échoué. Vérifiez l'adresse du destinataire.";
}

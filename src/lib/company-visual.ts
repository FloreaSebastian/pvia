/**
 * Identité visuelle d'une entreprise — source de vérité pour savoir
 * quel visuel afficher selon le contexte (UI compacte, PDF, emails…).
 *
 * Règles :
 *  - Logo principal → PDF, emails, exports, documents officiels.
 *  - Icône → UI compacte (sidebar, avatar, notifications, favicon).
 *  - Fallback autorisé uniquement côté documents : logo manquant → icône.
 *  - Les petits espaces UI ne doivent jamais afficher le logo à la place de l'icône.
 */
export type CompanyVisualSource = {
  logo_url?: string | null;
  icon_url?: string | null;
};

export type CompanyVisualIdentity = {
  /** Valeur brute de l'icône (peut être null). */
  iconUrl: string | null;
  /** Valeur brute du logo principal (peut être null). */
  logoUrl: string | null;
  /** Visuel à utiliser pour PDF / emails / pages publiques (logo > icône). */
  displayLogoUrl: string | null;
  /** Visuel à utiliser pour UI compacte (icône uniquement, sans fallback logo). */
  displayIconUrl: string | null;
};

export function getCompanyVisualIdentity(
  company: CompanyVisualSource | null | undefined,
): CompanyVisualIdentity {
  const logoUrl = company?.logo_url?.trim() || null;
  const iconUrl = company?.icon_url?.trim() || null;
  return {
    iconUrl,
    logoUrl,
    displayLogoUrl: logoUrl || iconUrl,
    displayIconUrl: iconUrl,
  };
}

// Contrat unique de mémorisation de l'entreprise active (navigateur).
// Le CompanyProvider relit cette préférence et ne la retient que si elle
// correspond à une adhésion active confirmée.
export const ACTIVE_COMPANY_STORAGE_KEY = "pvia:activeCompany";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readStoredCompanyId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(ACTIVE_COMPANY_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function storeCompanyId(id: string): void {
  if (typeof window === "undefined" || !UUID_RE.test(id)) return;
  try {
    window.localStorage.setItem(ACTIVE_COMPANY_STORAGE_KEY, id);
  } catch {
    // Le stockage peut être indisponible dans certaines WebView/tablettes.
  }
}

/**
 * Accepte une invitation puis sélectionne l'entreprise CONFIRMÉE PAR LE
 * SERVEUR. En cas d'échec, la préférence existante n'est pas modifiée.
 */
export async function acceptAndSelectCompany(
  accept: () => Promise<{ ok: true; companyId: string }>,
  store: (id: string) => void,
): Promise<string> {
  const res = await accept();
  if (!res?.ok || typeof res.companyId !== "string" || !UUID_RE.test(res.companyId))
    throw new Error("Réponse d'acceptation invalide.");
  store(res.companyId);
  return res.companyId;
}

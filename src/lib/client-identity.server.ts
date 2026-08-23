/**
 * Résolution de l'identité client globale (multi-entreprises).
 *
 * Modèle :
 *   client_identities (1)  ──►  clients (N, une ligne par entreprise)
 *                                  └─► pv / réserves / levées (par company_id)
 *
 * Règle absolue : l'identité est globale, les données métier ne le sont JAMAIS.
 * Une entreprise ne voit que ses propres lignes `clients` et ses propres
 * documents ; le client, lui, voit dans son espace tous les documents que
 * plusieurs entreprises lui ont explicitement adressés.
 *
 * Server-only : utilise supabaseAdmin (les tables client sont en deny-all RLS,
 * l'autorité d'autorisation est donc ici, jamais dans l'input utilisateur).
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
// Helper local (pas d'import depuis client-auth.server : ce module est atteignable
// depuis le graphe client via *.functions.ts et ne doit tirer aucune API serveur).
const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export type ClientRelation = {
  clientId: string;
  companyId: string | null;
  name: string | null;
  archivedAt: string | null;
  suspendedAt: string | null;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return EMAIL_RE.test(normalizeEmail(email));
}

/**
 * Crée/retrouve l'identité globale pour un email. Atomique côté Postgres
 * (upsert `ON CONFLICT` dans `resolve_client_identity`) : deux entreprises
 * créant le même email au même instant obtiennent la même identité, sans
 * jamais faire remonter une erreur "duplicate key" dans l'UI.
 */
export async function resolveIdentityId(email: string | null | undefined): Promise<string | null> {
  if (!isValidEmail(email)) return null;
  const { data, error } = await supabaseAdmin.rpc("resolve_client_identity", {
    _email: normalizeEmail(email as string),
  });
  if (error) {
    console.error("[client-identity] resolve failed", error);
    return null;
  }
  return (data as string | null) ?? null;
}

/** Identité existante uniquement (aucune création) — pour la détection côté entreprise. */
export async function findIdentityByEmail(email: string | null | undefined) {
  if (!isValidEmail(email)) return null;
  const { data } = await supabaseAdmin
    .from("client_identities")
    .select("id,status,invited_at,activated_at,last_login_at")
    .eq("normalized_email", normalizeEmail(email as string))
    .maybeSingle();
  return data ?? null;
}

/**
 * Toutes les relations métier rattachées à une identité authentifiée.
 * Les relations suspendues par leur entreprise sont exclues (suspension par
 * entreprise, jamais globale).
 */
export async function listIdentityRelations(identityId: string | null): Promise<ClientRelation[]> {
  if (!identityId) return [];
  const { data, error } = await supabaseAdmin
    .from("clients")
    .select("id,company_id,name,archived_at,portal_suspended_at")
    .eq("client_identity_id", identityId);
  if (error) {
    console.error("[client-identity] relations query failed", error);
    return [];
  }
  return (data ?? [])
    .filter((r: any) => !r.portal_suspended_at)
    .map((r: any) => ({
      clientId: r.id as string,
      companyId: (r.company_id ?? null) as string | null,
      name: (r.name ?? null) as string | null,
      archivedAt: (r.archived_at ?? null) as string | null,
      suspendedAt: (r.portal_suspended_at ?? null) as string | null,
    }));
}

/** Noms d'entreprises émettrices (affichage client uniquement). */
export async function loadCompanyLabels(companyIds: string[]) {
  const ids = Array.from(new Set(companyIds.filter(Boolean)));
  if (ids.length === 0) return new Map<string, string>();
  const { data } = await supabaseAdmin.from("companies").select("id,name").in("id", ids);
  return new Map<string, string>((data ?? []).map((c: any) => [c.id as string, (c.name ?? "") as string]));
}

/**
 * Marque l'identité comme active à la première authentification réussie.
 */
export async function markIdentityLogin(identityId: string | null) {
  if (!identityId) return;
  const now = new Date().toISOString();
  const { data: cur } = await supabaseAdmin
    .from("client_identities")
    .select("activated_at,status")
    .eq("id", identityId)
    .maybeSingle();
  await supabaseAdmin
    .from("client_identities")
    .update({
      last_login_at: now,
      activated_at: (cur as any)?.activated_at ?? now,
      status: (cur as any)?.status === "disabled" ? "disabled" : "active",
    } as never)
    .eq("id", identityId);
}

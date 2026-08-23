/**
 * Autorisation unique de l'Espace Client (multi-entreprises).
 *
 *   cookie session → identité globale → relations `clients` autorisées → PV
 *
 * L'UUID présent dans une URL n'est JAMAIS une autorisation : chaque accès
 * repasse par `fetchPvForClientScope`, qui vérifie l'appartenance côté serveur.
 * `sent_to_email` reste accepté en compatibilité pour les anciens PV, mais
 * l'autorisation de référence est la relation persistante identité → client.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  normalizeEmail,
  readClientCookieToken,
  sha256Hex,
} from "@/lib/client-auth.server";
import {
  findIdentityByEmail,
  listIdentityRelations,
  listSuspendedRelations,
  type ClientRelation,
} from "@/lib/client-identity.server";

export type ClientScope = {
  sessionId: string;
  /** @deprecated compat ancienne session mono-entreprise */
  clientId: string | null;
  identityId: string | null;
  email: string;
  relations: ClientRelation[];
  clientIds: string[];
  /** Relations suspendues par leur entreprise : refus explicite, prioritaire. */
  suspendedClientIds: string[];
  suspendedCompanyIds: string[];
};


const SESSION_EXPIRED = "Session expirée. Reconnectez-vous.";
/** Message volontairement identique pour "inexistant" et "interdit" (anti-IDOR). */
export const ACCESS_DENIED = "Document introuvable ou accès refusé.";

export async function requireClientScope(): Promise<ClientScope> {
  const token = readClientCookieToken();
  if (!token) throw new Error(SESSION_EXPIRED);
  const tokenHash = await sha256Hex(token);
  const { data } = await supabaseAdmin
    .from("client_sessions")
    .select("id,client_id,client_identity_id,email,expires_at,revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (!data || data.revoked_at) throw new Error(SESSION_EXPIRED);
  if (new Date(data.expires_at).getTime() <= Date.now()) throw new Error(SESSION_EXPIRED);

  const email = normalizeEmail(data.email);
  let identityId = (data as any).client_identity_id as string | null;
  if (!identityId) {
    // Migration douce des sessions antérieures au modèle multi-entreprises.
    identityId = (await findIdentityByEmail(email))?.id ?? null;
    if (identityId) {
      void supabaseAdmin
        .from("client_sessions")
        .update({ client_identity_id: identityId } as never)
        .eq("id", data.id);
    }
  }

  const relations = await listIdentityRelations(identityId);
  const ids = new Set(relations.map((r) => r.clientId));
  if (data.client_id) ids.add(data.client_id as string);

  return {
    sessionId: data.id as string,
    clientId: (data.client_id ?? null) as string | null,
    identityId,
    email,
    relations,
    clientIds: Array.from(ids),
  };
}

/** Le PV est-il accessible à ce périmètre ? (relation persistante, ou legacy email) */
export function isPvInScope(
  pv: { client_id?: string | null; sent_to_email?: string | null },
  scope: Pick<ClientScope, "clientIds" | "email">,
) {
  if (pv.client_id && scope.clientIds.includes(pv.client_id)) return true;
  if (pv.sent_to_email && normalizeEmail(pv.sent_to_email) === scope.email) return true;
  return false;
}

const PV_SCOPE_COLUMNS =
  "id,numero,status,type,description,observations,reception_date,signed_at,sent_to_client_at,sent_to_email,client_signature,company_signature,company_id,client_id,chantier_id,pdf_url,sign_token,sign_token_expires_at,created_at";

export async function fetchPvForClientScope(pvId: string, scope: ClientScope, columns = PV_SCOPE_COLUMNS) {
  const { data: pv } = await supabaseAdmin.from("pv").select(columns).eq("id", pvId).maybeSingle();
  // Aucune distinction entre "n'existe pas" et "pas à vous" : pas de fuite
  // d'existence, de nom d'entreprise ni de métadonnée sur un UUID deviné.
  if (!pv) throw new Error(ACCESS_DENIED);
  if (!isPvInScope(pv as any, scope)) throw new Error(ACCESS_DENIED);
  if ((pv as any).status === "brouillon") throw new Error(ACCESS_DENIED);
  return pv as any;
}

/** Clé d'entreprise opaque : permet de filtrer côté UI sans exposer d'UUID interne. */
export async function companyKey(companyId: string | null): Promise<string | null> {
  if (!companyId) return null;
  return (await sha256Hex(`company:${companyId}`)).slice(0, 12);
}

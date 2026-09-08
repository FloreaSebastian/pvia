/**
 * Notifications du portail de conformité sous-traitants (serveur uniquement).
 *
 * Réutilise STRICTEMENT les canaux existants de PVIA : table `notifications`
 * (in-app) + web push VAPID (`sendPushToUser`). Aucun moteur parallèle.
 *
 * Règles :
 *  - jamais d'URL signée dans une notification : le lien pointe vers la page
 *    sécurisée correspondante, qui re-signe après contrôle serveur ;
 *  - les destinataires sont toujours recalculés côté serveur à partir du
 *    tenant et de la relation concernée ;
 *  - meilleur effort : une notification ne doit jamais faire échouer l'action
 *    métier qui l'a déclenchée.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendPushToUser } from "./push.server";

/** Rôles internes habilités — même prédicat que la fonction SQL `is_company_admin`. */
export const COMPANY_ADMIN_ROLES = ["directeur", "responsable_exploitation"] as const;

export type NotifyPayload = {
  type: string;
  title: string;
  body: string;
  /** Chemin applicatif interne (jamais une URL de fichier signée). */
  url: string;
  tag?: string;
};

async function deliver(
  companyId: string,
  userIds: string[],
  payload: NotifyPayload,
): Promise<{ recipients: number; pushes: number }> {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (unique.length === 0) return { recipients: 0, pushes: 0 };

  const { error } = await supabaseAdmin.from("notifications").insert(
    unique.map((uid) => ({
      company_id: companyId,
      user_id: uid,
      type: payload.type,
      title: payload.title,
      body: payload.body,
    })),
  );
  if (error) console.error("[sc-notify] in-app insert failed", error.message);

  let pushes = 0;
  for (const uid of unique) {
    try {
      const r = await sendPushToUser(uid, {
        title: payload.title,
        body: payload.body,
        url: payload.url,
        ...(payload.tag ? { tag: payload.tag } : {}),
        data: { kind: payload.type },
      });
      pushes += r.sent;
    } catch {
      /* push best-effort */
    }
  }
  return { recipients: unique.length, pushes };
}

/** Administrateurs internes actifs du tenant (prédicat canonique). */
export async function notifyCompanyAdmins(companyId: string, payload: NotifyPayload) {
  const { data } = await supabaseAdmin
    .from("company_members")
    .select("user_id")
    .eq("company_id", companyId)
    .eq("status", "active")
    .in("role", COMPANY_ADMIN_ROLES as unknown as string[]);
  const ids = ((data ?? []) as { user_id: string | null }[])
    .map((m) => m.user_id)
    .filter((x): x is string => !!x);
  return deliver(companyId, ids, payload);
}

/**
 * Utilisateurs sous-traitants ACTIFS de CETTE relation uniquement
 * (même partenaire ET même tenant) : aucune fuite vers une autre entreprise.
 */
export async function notifySubcontractorUsers(
  companyId: string,
  subcontractorCompanyId: string,
  payload: NotifyPayload,
) {
  const { data } = await supabaseAdmin
    .from("subcontractor_memberships")
    .select("subcontractor_users!inner(user_id)")
    .eq("company_id", companyId)
    .eq("subcontractor_company_id", subcontractorCompanyId)
    .eq("status", "active")
    .is("revoked_at", null);

  const ids = ((data ?? []) as any[])
    .map((m) => m.subcontractor_users?.user_id as string | null)
    .filter((x): x is string => !!x);
  return deliver(companyId, ids, payload);
}

// Garde commune des actions serveur sur un document d'entreprise, exécutée AVANT
// tout effet (stockage, statut, email). Pure et injectable pour être testée.
import { MANAGE_ROLES, SIGN_ROLES } from "@/lib/roles";

export type ActionNeed = "manage" | "sign";

export type ActionAccessDeps = {
  getMember: (
    companyId: string,
    userId: string,
  ) => Promise<{ role: string; status: string } | null>;
  /** Lève une erreur si l'entreprise n'a pas l'accès écriture (abonnement, suspension). */
  assertWriteAccess: (companyId: string, userId: string) => Promise<void>;
};

export class ActionAccessError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

export async function authorizeCompanyAction(
  deps: ActionAccessDeps,
  companyId: string,
  userId: string,
  need: ActionNeed,
): Promise<{ role: string }> {
  const member = await deps.getMember(companyId, userId);
  if (!member || member.status !== "active")
    throw new ActionAccessError("Accès refusé.", "NOT_MEMBER");
  const allowed = (need === "sign" ? SIGN_ROLES : MANAGE_ROLES) as readonly string[];
  if (!allowed.includes(member.role)) {
    throw new ActionAccessError("Votre rôle ne permet pas cette action.", "ROLE_REQUIRED");
  }
  await deps.assertWriteAccess(companyId, userId);
  return { role: member.role };
}

/** Dépendances réelles (service role) : à n'appeler que côté serveur. */
export async function serverActionDeps(): Promise<ActionAccessDeps> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { assertCompanyWriteAccess } = await import("./plan-guard.server");
  return {
    getMember: async (companyId, userId) => {
      const { data } = await supabaseAdmin
        .from("company_members")
        .select("role,status")
        .eq("company_id", companyId)
        .eq("user_id", userId)
        .eq("status", "active")
        .maybeSingle();
      return data ? { role: String(data.role), status: String(data.status) } : null;
    },
    assertWriteAccess: async (companyId, userId) => {
      await assertCompanyWriteAccess(companyId, userId);
    },
  };
}

// Garde d'autorisation de createPv, exécutée AVANT tout effet (insert, upload,
// notification, PDF). Pure et injectable pour être testée sans base.
import { MANAGE_ROLES, SIGN_ROLES } from "@/lib/roles";

export type PvCreateGateInput = {
  companyId: string;
  status: "brouillon" | "signe" | "en_attente";
  client_id?: string | null;
  chantier_id?: string | null;
  client_signature?: string | null;
  company_signature?: string | null;
  client_otp_id?: string | null;
  reserves?: ReadonlyArray<{ status: string }>;
};

export type PvCreateGateDeps = {
  getMember: (companyId: string, userId: string) => Promise<{ role: string; status: string } | null>;
  /** true si la ligne existe ET appartient à companyId. */
  parentInCompany: (table: "clients" | "chantiers", id: string, companyId: string) => Promise<boolean>;
};

export const FINAL_RESERVE_STATUSES = ["levee", "en_attente_validation", "validee", "rejetee"] as const;

export class PvAccessError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

/** Le payload exige-t-il un rôle signataire (signature, finalisation, envoi, réserve finalisée) ? */
export function pvPayloadNeedsSign(input: PvCreateGateInput): boolean {
  return (
    input.status !== "brouillon" ||
    !!input.company_signature ||
    !!input.client_signature ||
    !!input.client_otp_id ||
    (input.reserves ?? []).some((r) => (FINAL_RESERVE_STATUSES as readonly string[]).includes(r.status))
  );
}

export async function authorizePvCreate(
  deps: PvCreateGateDeps,
  input: PvCreateGateInput,
  userId: string,
): Promise<{ role: string }> {
  const member = await deps.getMember(input.companyId, userId);
  if (!member || member.status !== "active") throw new PvAccessError("Accès refusé.", "NOT_MEMBER");
  if (!(MANAGE_ROLES as readonly string[]).includes(member.role)) {
    throw new PvAccessError("Votre rôle ne permet pas de créer un PV.", "ROLE_REQUIRED");
  }
  if (pvPayloadNeedsSign(input) && !(SIGN_ROLES as readonly string[]).includes(member.role)) {
    throw new PvAccessError(
      "Votre rôle permet de préparer un PV en brouillon, pas de le signer ni de l'envoyer.",
      "SIGN_ROLE_REQUIRED",
    );
  }
  if (input.client_id && !(await deps.parentInCompany("clients", input.client_id, input.companyId))) {
    throw new PvAccessError("Client introuvable dans cette entreprise.", "PARENT_TENANT");
  }
  if (input.chantier_id && !(await deps.parentInCompany("chantiers", input.chantier_id, input.companyId))) {
    throw new PvAccessError("Chantier introuvable dans cette entreprise.", "PARENT_TENANT");
  }
  return { role: member.role };
}

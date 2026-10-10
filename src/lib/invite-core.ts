// Cœur testable des invitations d'équipe (aucun import serveur) : les fonctions
// serveur injectent les accès base/email ; les tests injectent des faux.
import { ROLE_META, isAdminRole, type CompanyRoleValue } from "@/lib/roles";

export type InviteRow = {
  id: string;
  company_id: string;
  role: CompanyRoleValue | string;
  status: "active" | "invited" | "suspended" | string;
  user_id: string | null;
  invited_email: string | null;
  invite_expires_at: string | null;
  invite_token_hash: string | null;
};

export type InviteReason = "not_found" | "used" | "expired" | "wrong_recipient";

export const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;
/** Jeton d'invitation : 64 caractères hexadécimaux (2 UUID sans tirets). */
export const INVITE_TOKEN_RE = /^[a-f0-9]{64}$/;

export function normalizeInviteEmail(e: string | null | undefined): string {
  return (e ?? "").trim().toLowerCase();
}

/** Libellé humain d'un rôle (jamais le code enum à l'écran ou dans un email). */
export function inviteRoleLabel(role: string | null | undefined): string {
  return role && Object.prototype.hasOwnProperty.call(ROLE_META, role)
    ? ROLE_META[role as CompanyRoleValue].label
    : "Membre";
}

/** Invitation encore ouverte (sans contrôle du destinataire). Miroir SQL invite_recipient_matches. */
export function inviteOpenState(row: InviteRow | null, now: number): InviteReason | null {
  if (!row) return "not_found";
  if (row.status !== "invited" || row.user_id !== null) return "used";
  if (!row.invite_expires_at || new Date(row.invite_expires_at).getTime() <= now) return "expired";
  if (!normalizeInviteEmail(row.invited_email)) return "not_found";
  return null;
}

export function inviteUsableFor(
  row: InviteRow | null,
  email: string | null | undefined,
  now: number,
): { ok: true } | { ok: false; reason: InviteReason } {
  const state = inviteOpenState(row, now);
  if (state) return { ok: false, reason: state };
  const e = normalizeInviteEmail(email);
  if (!e || e !== normalizeInviteEmail(row!.invited_email))
    return { ok: false, reason: "wrong_recipient" };
  return { ok: true };
}

/** Une invitation active non expirée occupe déjà un siège (même règle que le trigger quota). */
export function inviteOccupiesSeat(row: InviteRow | null, now: number): boolean {
  return (
    !!row &&
    row.status === "invited" &&
    !!row.invite_expires_at &&
    new Date(row.invite_expires_at).getTime() > now
  );
}

export class InviteError extends Error {
  constructor(
    public code:
      | "forbidden"
      | "write_closed"
      | "self"
      | "already_member"
      | "rate_limited"
      | "conflict"
      | "not_found"
      | "used"
      | "expired"
      | "wrong_recipient"
      | "unverified"
      | "suspended",
    message: string,
  ) {
    super(message);
    this.name = "InviteError";
  }
}

const REASON_MESSAGE: Record<InviteReason, string> = {
  not_found: "Invitation introuvable.",
  used: "Invitation déjà utilisée.",
  expired: "Invitation expirée.",
  wrong_recipient: "Cette invitation est destinée à une autre adresse email.",
};

/* ------------------------------------------------------------------ */
/* Création / renvoi                                                   */
/* ------------------------------------------------------------------ */

export type PrepareInviteDeps = {
  getCallerMembership: (
    companyId: string,
    userId: string,
  ) => Promise<{ role: string; status: string } | null>;
  hasWriteAccess: (companyId: string) => Promise<boolean>;
  /** Invitation non rattachée (user_id NULL) pour cet email (insensible à la casse). */
  findPendingInvite: (companyId: string, email: string) => Promise<InviteRow | null>;
  /** Membre déjà rattaché avec cet email ? */
  isExistingMemberEmail: (companyId: string, email: string) => Promise<boolean>;
  /** Lève si aucun siège supplémentaire n'est disponible. */
  assertCanAddSeat: (companyId: string) => Promise<void>;
  /** Lève si un email identique vient d'être envoyé. */
  assertNotRecentlySent: (companyId: string, email: string) => Promise<void>;
  newToken: () => Promise<{ token: string; hash: string }>;
  /** UPDATE … WHERE id, company_id, status invited, user_id NULL, hash = ancien hash ; ligne ou null. */
  casRotateInvite: (
    existing: InviteRow,
    patch: { role: string; token_hash: string; expires_at: string; invited_by: string },
  ) => Promise<InviteRow | null>;
  insertInvite: (row: {
    company_id: string;
    invited_email: string;
    role: string;
    token_hash: string;
    expires_at: string;
    invited_by: string;
  }) => Promise<InviteRow>;
};

export type PrepareInviteInput = {
  userId: string;
  callerEmail: string | null;
  companyId: string;
  email: string;
  role: Exclude<CompanyRoleValue, "directeur">;
  now: number;
};

/**
 * Ordre garanti : droits ADMIN actif → écriture → identité → invitation
 * existante (siège déjà occupé ?) → quota si nécessaire → anti-renvoi → jeton
 * → écriture CAS. Aucun effet avant les refus.
 */
export async function prepareInvite(deps: PrepareInviteDeps, input: PrepareInviteInput) {
  const email = normalizeInviteEmail(input.email);
  if ((input.role as string) === "directeur")
    throw new InviteError(
      "forbidden",
      "Le rôle Directeur ne peut pas être attribué par invitation.",
    );
  const m = await deps.getCallerMembership(input.companyId, input.userId);
  if (!m || m.status !== "active" || !isAdminRole(m.role))
    throw new InviteError("forbidden", "Vous n'avez pas les droits pour inviter des membres.");
  if (!(await deps.hasWriteAccess(input.companyId)))
    throw new InviteError("write_closed", "Accès en écriture indisponible pour cette entreprise.");
  if (normalizeInviteEmail(input.callerEmail) === email)
    throw new InviteError("self", "Vous faites déjà partie de cette entreprise.");
  if (await deps.isExistingMemberEmail(input.companyId, email))
    throw new InviteError("already_member", "Cette personne est déjà membre de l'entreprise.");

  const existing = await deps.findPendingInvite(input.companyId, email);
  if (!inviteOccupiesSeat(existing, input.now)) await deps.assertCanAddSeat(input.companyId);

  // Avant toute rotation : un second appel rapide ne doit pas invalider le premier lien.
  await deps.assertNotRecentlySent(input.companyId, email);

  const { token, hash } = await deps.newToken();
  const expiresAt = new Date(input.now + INVITE_TTL_MS).toISOString();
  let row: InviteRow | null;
  if (existing) {
    if (existing.status !== "invited")
      throw new InviteError("conflict", "Cette adresse ne peut pas être réinvitée en l'état.");
    row = await deps.casRotateInvite(existing, {
      role: input.role,
      token_hash: hash,
      expires_at: expiresAt,
      invited_by: input.userId,
    });
    if (!row)
      throw new InviteError("conflict", "L'invitation a changé entre-temps. Rechargez l'équipe.");
  } else {
    row = await deps.insertInvite({
      company_id: input.companyId,
      invited_email: email,
      role: input.role,
      token_hash: hash,
      expires_at: expiresAt,
      invited_by: input.userId,
    });
  }
  return { token, row, email, expiresAt, resent: !!existing };
}

/* ------------------------------------------------------------------ */
/* Acceptation                                                          */
/* ------------------------------------------------------------------ */

export type AcceptInviteDeps = {
  findInviteByHash: (hash: string) => Promise<InviteRow | null>;
  /** Email et vérification lus côté Auth (jamais depuis la metadata). */
  getAuthIdentity: (userId: string) => Promise<{ email: string | null; verified: boolean } | null>;
  findMembership: (
    companyId: string,
    userId: string,
  ) => Promise<{ id: string; status: string } | null>;
  /** UPDATE … WHERE id, hash présenté, status invited, user_id NULL, non expirée → active. */
  casActivate: (invite: InviteRow, hash: string, userId: string) => Promise<InviteRow | null>;
  /** DELETE … WHERE id, hash présenté, status invited, user_id NULL. */
  casConsume: (invite: InviteRow, hash: string) => Promise<boolean>;
};

export async function acceptInviteCore(
  deps: AcceptInviteDeps,
  input: {
    userId: string;
    sessionEmail: string | null | undefined;
    tokenHash: string;
    now: number;
  },
) {
  const sessionEmail = normalizeInviteEmail(input.sessionEmail);
  if (!sessionEmail)
    throw new InviteError("unverified", "Votre session ne comporte pas d'adresse email vérifiée.");
  const identity = await deps.getAuthIdentity(input.userId);
  if (!identity || !identity.verified || normalizeInviteEmail(identity.email) !== sessionEmail)
    throw new InviteError(
      "unverified",
      "Confirmez d'abord votre adresse email, puis rouvrez l'invitation.",
    );

  const invite = await deps.findInviteByHash(input.tokenHash);
  const usable = inviteUsableFor(invite, sessionEmail, input.now);
  if (!usable.ok) throw new InviteError(usable.reason, REASON_MESSAGE[usable.reason]);

  const existing = await deps.findMembership(invite!.company_id, input.userId);
  if (existing) {
    if (existing.status !== "active")
      throw new InviteError(
        "suspended",
        "Votre accès à cette entreprise est suspendu. Contactez un administrateur.",
      );
    // Consomme uniquement CETTE invitation (token présenté), sans toucher l'adhésion.
    const consumed = await deps.casConsume(invite!, input.tokenHash);
    if (!consumed) throw new InviteError("used", REASON_MESSAGE.used);
    return {
      ok: true as const,
      alreadyMember: true as const,
      companyId: invite!.company_id,
      role: invite!.role,
    };
  }

  const row = await deps.casActivate(invite!, input.tokenHash, input.userId);
  if (!row) throw new InviteError("used", "Cette invitation a changé ou a déjà été utilisée.");
  return {
    ok: true as const,
    alreadyMember: false as const,
    companyId: row.company_id,
    role: row.role,
    inviteId: row.id,
  };
}

/* ------------------------------------------------------------------ */
/* Éligibilité au code de connexion professionnel                      */
/* ------------------------------------------------------------------ */

export type LoginEligibilityDeps = {
  findUserByEmail: (email: string) => Promise<{ id: string } | null>;
  findActiveMembershipCompany: (userId: string) => Promise<string | null>;
  findInviteByHash: (hash: string) => Promise<InviteRow | null>;
  hashToken: (token: string) => Promise<string>;
};

/**
 * Un code n'est envoyé qu'à un membre actif, ou — avec un jeton d'invitation
 * valide destiné EXACTEMENT à cet email — à un compte existant sans adhésion.
 * Envoyer le code n'ouvre aucun droit : l'acceptation reste serveur.
 */
export async function enterpriseLoginEligibility(
  deps: LoginEligibilityDeps,
  input: { email: string; inviteToken?: string | null; now: number },
): Promise<
  | { ok: true; userId: string; companyId: string; via: "member" | "invite" }
  | {
      ok: false;
      userId: string | null;
      reason: "unknown_enterprise_email" | "not_active_enterprise_member" | InviteReason;
    }
> {
  const email = normalizeInviteEmail(input.email);
  const user = await deps.findUserByEmail(email);
  if (!user) return { ok: false, userId: null, reason: "unknown_enterprise_email" };
  const companyId = await deps.findActiveMembershipCompany(user.id);
  if (companyId) return { ok: true, userId: user.id, companyId, via: "member" };
  if (!input.inviteToken || !INVITE_TOKEN_RE.test(input.inviteToken))
    return { ok: false, userId: user.id, reason: "not_active_enterprise_member" };
  const invite = await deps.findInviteByHash(await deps.hashToken(input.inviteToken));
  const usable = inviteUsableFor(invite, email, input.now);
  if (!usable.ok) return { ok: false, userId: user.id, reason: usable.reason };
  return { ok: true, userId: user.id, companyId: invite!.company_id, via: "invite" };
}

/** Retour après vérification : uniquement /invite/<jeton valide>, sinon null. */
export function inviteReturnPath(token: string | null | undefined): string | null {
  return token && INVITE_TOKEN_RE.test(token) ? `/invite/${token}` : null;
}

/* ------------------------------------------------------------------ */
/* Inscription bornée à l'invitation                                   */
/* ------------------------------------------------------------------ */

export const INVITE_PASSWORD_MIN = 8;

export type InviteSignupDeps = {
  findInviteByHash: (hash: string) => Promise<InviteRow | null>;
  hashToken: (token: string) => Promise<string>;
  appUrl: () => string;
  signUp: (args: {
    email: string;
    password: string;
    redirectTo: string;
    fullName: string;
    token: string;
  }) => Promise<{ error: string | null }>;
};

export async function inviteSignupCore(
  deps: InviteSignupDeps,
  input: { token: string; password: string; fullName: string; now: number },
) {
  if (!INVITE_TOKEN_RE.test(input.token))
    throw new InviteError("not_found", REASON_MESSAGE.not_found);
  if (input.password.length < INVITE_PASSWORD_MIN)
    throw new InviteError(
      "forbidden",
      `Mot de passe trop court (${INVITE_PASSWORD_MIN} caractères minimum).`,
    );
  const invite = await deps.findInviteByHash(await deps.hashToken(input.token));
  const state = inviteOpenState(invite, input.now);
  if (state) throw new InviteError(state, REASON_MESSAGE[state]);
  // Email dérivé de l'invitation, jamais saisi par le client.
  const email = normalizeInviteEmail(invite!.invited_email);
  const res = await deps.signUp({
    email,
    password: input.password,
    redirectTo: `${deps.appUrl()}/invite/${input.token}`,
    fullName: input.fullName.trim().slice(0, 120),
    token: input.token,
  });
  if (res.error)
    throw new InviteError(
      "conflict",
      "Création du compte impossible. Si vous avez déjà un compte, connectez-vous.",
    );
  return { ok: true as const, email };
}

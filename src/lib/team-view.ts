// Logique pure de la page Équipe (regroupement, recherche, droits par ligne,
// édition de rôle confirmée). Miroir UI des règles serveur/RLS, jamais plus large.
import { ROLE_ORDER, isAdminRole, isOwnerRole, type CompanyRoleValue } from "@/lib/roles";
import { asKnownRole } from "@/lib/role-access";

export type TeamMember = {
  id: string;
  user_id: string | null;
  role: CompanyRoleValue | string;
  status: "active" | "invited" | "suspended" | string;
  invited_email: string | null;
  invite_expires_at: string | null;
  created_at: string;
  profile?: { full_name: string | null } | null;
};

/** Le rôle Directeur ne se distribue jamais (invitation ou modification). */
export const ASSIGNABLE_ROLES: CompanyRoleValue[] = ROLE_ORDER.filter((r) => r !== "directeur");

export function memberIdentity(m: TeamMember): { primary: string; secondary: string | null } {
  if (m.status === "invited" && !m.user_id) return { primary: m.invited_email || "Invitation", secondary: null };
  return { primary: m.profile?.full_name?.trim() || "Membre sans nom", secondary: null };
}

export function inviteExpired(m: TeamMember, now: number): boolean {
  return m.status === "invited" && (!m.invite_expires_at || new Date(m.invite_expires_at).getTime() <= now);
}

function norm(s: string) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function groupMembers(members: TeamMember[], query: string) {
  const q = norm(query);
  const match = (m: TeamMember) =>
    !q || norm(`${m.profile?.full_name ?? ""} ${m.invited_email ?? ""}`).includes(q);
  const filtered = members.filter(match);
  const pick = (s: string) => filtered.filter((m) => m.status === s);
  return {
    active: pick("active"),
    invited: pick("invited"),
    suspended: pick("suspended"),
    counts: {
      active: members.filter((m) => m.status === "active").length,
      invited: members.filter((m) => m.status === "invited").length,
      suspended: members.filter((m) => m.status === "suspended").length,
    },
    total: members.length,
    /** Recherche active sans résultat (différent d'une équipe vide). */
    noResult: members.length > 0 && filtered.length === 0,
  };
}

export type RowCtx = {
  currentUserId: string | null;
  actorRole: string | null;
  /** Écriture confirmée (abonnement/suspension connus et ouverts). */
  writeOpen: boolean;
};

export function memberRights(m: TeamMember, ctx: RowCtx) {
  const actor = asKnownRole(ctx.actorRole);
  const isAdmin = !!actor && isAdminRole(actor);
  const isDirecteur = !!actor && isOwnerRole(actor);
  const isSelf = !!m.user_id && !!ctx.currentUserId && m.user_id === ctx.currentUserId;
  const isDirectorMember = isOwnerRole(m.role as string);
  const isInvite = m.status === "invited" && !m.user_id;
  const w = ctx.writeOpen;
  const canEdit = isAdmin && !isSelf && (!isDirectorMember || isDirecteur);
  return {
    isSelf,
    isInvite,
    isDirectorMember,
    canEditRole: w && canEdit && !isInvite && !isDirectorMember,
    canToggle: w && canEdit && !isInvite,
    canRemove: w && canEdit && isDirecteur && !isInvite,
    canManageInvite: w && isAdmin && isInvite,
  };
}

export type TeamAction = "role" | "suspend" | "reactivate" | "remove" | "resend" | "cancel_invite";

/** Refus des actions inconnues ou non autorisées pour la ligne. */
export function canRunAction(action: unknown, m: TeamMember, ctx: RowCtx): boolean {
  const r = memberRights(m, ctx);
  switch (action as TeamAction) {
    case "role":
      return r.canEditRole;
    case "suspend":
      return r.canToggle && m.status === "active";
    case "reactivate":
      return r.canToggle && m.status === "suspended";
    case "remove":
      return r.canRemove;
    case "resend":
    case "cancel_invite":
      return r.canManageInvite;
    default:
      return false;
  }
}

/**
 * Session d'édition de rôle : choisir un rôle ne modifie rien ; seul
 * `save()` appelle la mutation, une seule fois, si le rôle est valide et différent.
 */
export function createRoleEdit(
  member: TeamMember,
  mutate: (memberId: string, role: CompanyRoleValue) => Promise<boolean>,
) {
  let draft: CompanyRoleValue | null = asKnownRole(member.role);
  let saving = false;
  let done = false;
  return {
    get draft() {
      return draft;
    },
    get changed() {
      return !!draft && draft !== member.role;
    },
    choose(role: unknown) {
      const r = asKnownRole(role);
      if (!r || !ASSIGNABLE_ROLES.includes(r) || done) return false;
      draft = r;
      return true;
    },
    async save(): Promise<"saved" | "unchanged" | "busy" | "failed"> {
      if (saving || done) return "busy";
      if (!draft || draft === member.role) return "unchanged";
      saving = true;
      try {
        const ok = await mutate(member.id, draft);
        if (ok) done = true;
        return ok ? "saved" : "failed";
      } finally {
        saving = false;
      }
    },
    cancel() {
      done = true;
    },
  };
}

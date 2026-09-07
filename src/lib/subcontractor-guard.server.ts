/**
 * Garde d'autorisation centralisée du module Sous-traitants (serveur uniquement).
 *
 * Règles non négociables :
 * - Le contexte tenant est TOUJOURS dérivé de la session serveur, jamais d'un
 *   identifiant fourni par le client.
 * - Un sous-traitant n'accède qu'aux ressources d'une affectation active.
 * - Une révocation / suspension est effective immédiatement (aucun cache).
 * - Les gardes d'abonnement de l'entreprise donneuse d'ordre s'appliquent
 *   exactement comme pour un utilisateur interne.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  effectivePermissions,
  hasPermission,
  type SubcontractorPermission,
  type SubcontractorPermissionMap,
} from "./subcontractor-permissions";

export class SubcontractorAccessError extends Error {
  statusCode = 403;
  constructor(message = "Accès refusé.") {
    super(message);
    this.name = "SubcontractorAccessError";
  }
}

export type SubcontractorMembershipCtx = {
  membershipId: string;
  companyId: string;
  companyName: string;
  subcontractorCompanyId: string;
  subcontractorCompanyName: string;
  subcontractorUserId: string;
  jobTitle: string | null;
  permissions: SubcontractorPermissionMap;
};

/** Identité sous-traitante liée au compte connecté (ou null). */
export async function getSubcontractorIdentity(userId: string) {
  const { data } = await supabaseAdmin
    .from("subcontractor_users")
    .select("id,email,full_name,phone")
    .eq("user_id", userId)
    .maybeSingle();
  return data ?? null;
}

/** Toutes les relations ACTIVES du compte connecté (multi-entreprises). */
export async function listActiveMemberships(userId: string): Promise<SubcontractorMembershipCtx[]> {
  const identity = await getSubcontractorIdentity(userId);
  if (!identity) return [];
  const { data } = await supabaseAdmin
    .from("subcontractor_memberships")
    .select(
      "id,company_id,subcontractor_company_id,job_title,permissions,status,revoked_at," +
        "companies!inner(id,name)," +
        "subcontractor_companies!inner(id,name,status)",
    )
    .eq("subcontractor_user_id", identity.id)
    .eq("status", "active")
    .is("revoked_at", null);

  return ((data ?? []) as any[])
    .filter((m) => m.subcontractor_companies?.status === "active")
    .map((m) => ({
      membershipId: m.id as string,
      companyId: m.company_id as string,
      companyName: (m.companies?.name as string) ?? "Entreprise",
      subcontractorCompanyId: m.subcontractor_company_id as string,
      subcontractorCompanyName: (m.subcontractor_companies?.name as string) ?? "",
      subcontractorUserId: identity.id as string,
      jobTitle: (m.job_title as string) ?? null,
      permissions: effectivePermissions(m.permissions),
    }));
}

/** Relation active pour une entreprise donnée, sinon erreur 403. */
export async function requireMembership(
  userId: string,
  companyId: string,
): Promise<SubcontractorMembershipCtx> {
  const all = await listActiveMemberships(userId);
  const found = all.find((m) => m.companyId === companyId);
  if (!found) throw new SubcontractorAccessError("Vous n'avez plus accès à cette entreprise.");
  return found;
}

export type AssignmentCtx = {
  assignment: {
    id: string;
    company_id: string;
    chantier_id: string;
    membership_id: string;
    technical_visit_id: string | null;
    mission: string;
    status: string;
    scheduled_at: string | null;
    scheduled_end_at: string | null;
    comment: string | null;
  };
  membership: SubcontractorMembershipCtx;
  permissions: SubcontractorPermissionMap;
};

/**
 * Résout une affectation appartenant réellement au sous-traitant connecté.
 * Protection IDOR : l'identifiant fourni n'est jamais accepté tel quel.
 */
export async function requireAssignment(userId: string, assignmentId: string): Promise<AssignmentCtx> {
  const memberships = await listActiveMemberships(userId);
  if (memberships.length === 0) throw new SubcontractorAccessError();

  const { data } = await supabaseAdmin
    .from("subcontractor_assignments")
    .select(
      "id,company_id,chantier_id,membership_id,technical_visit_id,mission,status,scheduled_at,scheduled_end_at,comment,permission_overrides",
    )
    .eq("id", assignmentId)
    .maybeSingle();

  if (!data) throw new SubcontractorAccessError("Intervention introuvable.");
  const membership = memberships.find((m) => m.membershipId === data.membership_id);
  if (!membership || membership.companyId !== data.company_id) throw new SubcontractorAccessError();
  if (data.status === "cancelled") throw new SubcontractorAccessError("Intervention annulée.");

  return {
    assignment: data as AssignmentCtx["assignment"],
    membership,
    permissions: effectivePermissions(
      // permissions de la relation rechargées + surcharges chantier
      invertToRaw(membership.permissions),
      (data as any).permission_overrides,
    ),
  };
}

function invertToRaw(map: SubcontractorPermissionMap): Record<string, boolean> {
  return { ...(map as Record<string, boolean>) };
}

/** Vérifie qu'une affectation active existe sur ce chantier pour ce compte. */
export async function requireChantierAccess(userId: string, chantierId: string) {
  const memberships = await listActiveMemberships(userId);
  if (memberships.length === 0) throw new SubcontractorAccessError();
  const { data } = await supabaseAdmin
    .from("subcontractor_assignments")
    .select("id,company_id,chantier_id,membership_id,permission_overrides,status")
    .eq("chantier_id", chantierId)
    .in(
      "membership_id",
      memberships.map((m) => m.membershipId),
    )
    .neq("status", "cancelled");

  const rows = (data ?? []) as any[];
  if (rows.length === 0) throw new SubcontractorAccessError("Chantier non affecté.");
  const membership = memberships.find((m) => m.membershipId === rows[0].membership_id)!;
  // Union des permissions effectives sur ce chantier (plusieurs interventions possibles)
  let perms: SubcontractorPermissionMap = {};
  for (const r of rows) {
    const m = memberships.find((x) => x.membershipId === r.membership_id);
    if (!m) continue;
    const eff = effectivePermissions(invertToRaw(m.permissions), r.permission_overrides);
    perms = { ...perms, ...eff };
  }
  return { membership, permissions: perms, assignmentIds: rows.map((r) => r.id as string) };
}

export function assertPermission(perms: SubcontractorPermissionMap, key: SubcontractorPermission) {
  if (!hasPermission(perms, key)) {
    throw new SubcontractorAccessError("Cette action ne vous est pas autorisée.");
  }
}

/**
 * Les actions d'écriture d'un sous-traitant consomment les droits de
 * l'entreprise donneuse d'ordre : mêmes gardes d'abonnement que l'interne.
 */
export async function assertCompanyWritable(companyId: string) {
  const { assertSubscriptionUsable } = await import("./plan-guard.server");
  await assertSubscriptionUsable(companyId);
}

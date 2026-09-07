/**
 * Administration du module Sous-traitants (côté entreprise donneuse d'ordre).
 *
 * Toutes les écritures exigent :
 *  - une session professionnelle valide (`requireSupabaseAuth`),
 *  - un rôle administrateur d'entreprise (`is_company_admin`),
 *  - un abonnement autorisant l'écriture (mêmes gardes que l'interne).
 *
 * Le `companyId` est systématiquement re-vérifié côté serveur : aucune
 * ressource n'est jamais servie sur la seule foi d'un identifiant client.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { writeAuditLog } from "./audit.server";
import { enforceRateLimit } from "./rate-limit.server";
import { normalizeEmail, sha256Hex } from "./client-auth.server";
import { getPublicAppUrl } from "./app-url.server";
import {
  normalizePermissions,
  permissionsFromPreset,
  SUBCONTRACTOR_PERMISSIONS,
  type SubcontractorPreset,
} from "./subcontractor-permissions";
import {
  sendSubcontractorAssignmentEmail,
  sendSubcontractorInviteEmail,
} from "./subcontractor-email.server";

const INVITE_TTL_DAYS = 14;

async function assertAdmin(sb: SupabaseClient<Database>, companyId: string, userId: string) {
  const { data, error } = await sb.rpc("is_company_admin", { _company_id: companyId, _user_id: userId });
  if (error) throw new Error("Vérification des droits impossible.");
  if (data !== true) throw new Error("Droits insuffisants (administration entreprise requise).");
}

async function assertAdminWrite(sb: SupabaseClient<Database>, companyId: string, userId: string) {
  await assertAdmin(sb, companyId, userId);
  const { assertSubscriptionUsable } = await import("./plan-guard.server");
  await assertSubscriptionUsable(companyId, userId);
}

async function assertMember(sb: SupabaseClient<Database>, companyId: string, userId: string) {
  const { data, error } = await sb.rpc("is_company_member", { _company_id: companyId, _user_id: userId });
  if (error) throw new Error("Vérification des droits impossible.");
  if (data !== true) throw new Error("Droits insuffisants.");
}

const PermissionsSchema = z
  .record(z.string(), z.boolean())
  .transform((raw) => normalizePermissions(raw));

const PresetSchema = z.enum(["terrain", "visite_technique", "chef_equipe", "custom"]);

function resolvePermissions(preset: SubcontractorPreset, explicit?: Record<string, boolean>) {
  if (preset !== "custom") return permissionsFromPreset(preset);
  return normalizePermissions(explicit ?? {});
}

// ---------------------------------------------------------------- lectures

export const listSubcontractors = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, data.companyId, userId);

    const [companiesRes, membershipsRes, assignRes] = await Promise.all([
      supabase
        .from("subcontractor_companies")
        .select("*")
        .eq("company_id", data.companyId)
        .order("created_at", { ascending: false }),
      supabase
        .from("subcontractor_memberships")
        .select(
          "id,company_id,subcontractor_company_id,subcontractor_user_id,job_title,status,permissions,preset,invited_at,accepted_at,last_activity_at,created_at," +
            "subcontractor_users!inner(id,email,full_name,phone,last_login_at)",
        )
        .eq("company_id", data.companyId)
        .order("created_at", { ascending: false }),
      supabase
        .from("subcontractor_assignments")
        .select("id,membership_id,chantier_id,status,scheduled_at,mission")
        .eq("company_id", data.companyId)
        .neq("status", "cancelled"),
    ]);

    const assignments = assignRes.data ?? [];
    const memberships = (membershipsRes.data ?? []).map((m: any) => ({
      ...m,
      contact: m.subcontractor_users,
      activeAssignments: assignments.filter(
        (a) => a.membership_id === m.id && a.status !== "done",
      ).length,
    }));

    return {
      companies: companiesRes.data ?? [],
      memberships,
      assignments,
    };
  });

export const getSubcontractorDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ companyId: z.string().uuid(), subcontractorCompanyId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, data.companyId, userId);

    const { data: sc } = await supabase
      .from("subcontractor_companies")
      .select("*")
      .eq("id", data.subcontractorCompanyId)
      .eq("company_id", data.companyId)
      .maybeSingle();
    if (!sc) throw new Error("Sous-traitant introuvable.");

    const { data: memberships } = await supabase
      .from("subcontractor_memberships")
      .select(
        "id,job_title,status,permissions,preset,invited_at,accepted_at,last_activity_at," +
          "subcontractor_users!inner(id,email,full_name,phone,last_login_at)",
      )
      .eq("company_id", data.companyId)
      .eq("subcontractor_company_id", data.subcontractorCompanyId);

    const ids = (memberships ?? []).map((m: any) => m.id);
    const { data: assignments } = ids.length
      ? await supabase
          .from("subcontractor_assignments")
          .select("*, chantiers!inner(id,reference,name,address)")
          .in("membership_id", ids)
          .order("scheduled_at", { ascending: false, nullsFirst: false })
          .limit(200)
      : { data: [] as any[] };

    return { company: sc, memberships: memberships ?? [], assignments: assignments ?? [] };
  });

// ------------------------------------------------- entreprises sous-traitantes

const CompanySchema = z.object({
  companyId: z.string().uuid(),
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(160),
  trade_name: z.string().trim().max(160).optional().default(""),
  siret: z
    .string()
    .trim()
    .max(20)
    .optional()
    .default("")
    .refine((v) => v === "" || /^\d{9,14}$/.test(v.replace(/\s/g, "")), "SIRET invalide"),
  address: z.string().trim().max(300).optional().default(""),
  phone: z.string().trim().max(40).optional().default(""),
  email: z.union([z.string().email().max(255), z.literal("")]).optional().default(""),
  website: z.union([z.string().url().max(300), z.literal("")]).optional().default(""),
  notes: z.string().trim().max(4000).optional().default(""),
  trades: z.array(z.string().trim().min(1).max(60)).max(20).optional().default([]),
});

export const saveSubcontractorCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => CompanySchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdminWrite(supabase, data.companyId, userId);

    const payload = {
      company_id: data.companyId,
      name: data.name,
      trade_name: data.trade_name || null,
      siret: data.siret ? data.siret.replace(/\s/g, "") : null,
      address: data.address || null,
      phone: data.phone || null,
      email: data.email ? normalizeEmail(data.email) : null,
      website: data.website || null,
      notes: data.notes || null,
      trades: data.trades,
    };

    let id = data.id;
    if (id) {
      const { error } = await supabase
        .from("subcontractor_companies")
        .update(payload)
        .eq("id", id)
        .eq("company_id", data.companyId);
      if (error) throw new Error("Enregistrement impossible.");
    } else {
      const { data: created, error } = await supabase
        .from("subcontractor_companies")
        .insert({ ...payload, created_by: userId })
        .select("id")
        .single();
      if (error || !created) throw new Error("Création impossible.");
      id = created.id;
    }

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "subcontractor_company",
      entityId: id!,
      action: (data.id ? "member.role_changed" : "member.invited") as never,
      metadata: { scope: "subcontractor_company", name: data.name, mode: data.id ? "update" : "create" },
    });

    return { ok: true as const, id: id! };
  });

export const setSubcontractorCompanyStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        companyId: z.string().uuid(),
        id: z.string().uuid(),
        status: z.enum(["active", "suspended", "archived"]),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdminWrite(supabase, data.companyId, userId);

    const { error } = await supabase
      .from("subcontractor_companies")
      .update({
        status: data.status,
        archived_at: data.status === "archived" ? new Date().toISOString() : null,
      })
      .eq("id", data.id)
      .eq("company_id", data.companyId);
    if (error) throw new Error("Mise à jour impossible.");

    // Révocation immédiate des accès quand l'entreprise n'est plus active.
    if (data.status !== "active") {
      await supabase
        .from("subcontractor_memberships")
        .update({ status: "suspended", suspended_at: new Date().toISOString() })
        .eq("company_id", data.companyId)
        .eq("subcontractor_company_id", data.id)
        .eq("status", "active");
    }

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "subcontractor_company",
      entityId: data.id,
      action: (data.status === "active" ? "member.reactivated" : "member.suspended") as never,
      metadata: { scope: "subcontractor_company", status: data.status },
    });
    return { ok: true as const };
  });

// -------------------------------------------------------------- invitations

export const inviteSubcontractor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        companyId: z.string().uuid(),
        subcontractorCompanyId: z.string().uuid(),
        email: z.string().email().max(255),
        fullName: z.string().trim().max(160).optional().default(""),
        phone: z.string().trim().max(40).optional().default(""),
        jobTitle: z.string().trim().max(120).optional().default(""),
        preset: PresetSchema.default("terrain"),
        permissions: z.record(z.string(), z.boolean()).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdminWrite(supabase, data.companyId, userId);
    await enforceRateLimit({
      bucket: "subcontractor_invite_send",
      key: `${data.companyId}`,
      limit: 30,
      windowSec: 3600,
    });

    const { data: sc } = await supabase
      .from("subcontractor_companies")
      .select("id,name,status")
      .eq("id", data.subcontractorCompanyId)
      .eq("company_id", data.companyId)
      .maybeSingle();
    if (!sc) throw new Error("Sous-traitant introuvable.");
    if (sc.status !== "active") throw new Error("Ce sous-traitant est suspendu ou archivé.");

    const email = normalizeEmail(data.email);

    // Interdiction stricte : un membre interne ne peut pas être sous-traitant.
    const { data: internal } = await supabaseAdmin
      .from("company_members")
      .select("id,user_id")
      .eq("company_id", data.companyId)
      .eq("status", "active");
    if ((internal ?? []).length) {
      const ids = (internal ?? []).map((m: any) => m.user_id).filter(Boolean);
      const { data: profs } = await supabaseAdmin.from("profiles").select("id,email").in("id", ids);
      if ((profs ?? []).some((p: any) => normalizeEmail(p.email ?? "") === email)) {
        throw new Error("Cette adresse appartient déjà à un membre interne de l'entreprise.");
      }
    }

    // Identité sous-traitante globale (partagée entre entreprises).
    const { data: existingIdentity } = await supabaseAdmin
      .from("subcontractor_users")
      .select("id,user_id,full_name,phone")
      .ilike("email", email)
      .maybeSingle();

    let identityId = existingIdentity?.id ?? null;
    if (!identityId) {
      const { data: created, error } = await supabaseAdmin
        .from("subcontractor_users")
        .insert({ email, full_name: data.fullName || null, phone: data.phone || null })
        .select("id")
        .single();
      if (error || !created) throw new Error("Création de l'accès impossible.");
      identityId = created.id;
    } else if (data.fullName || data.phone) {
      await supabaseAdmin
        .from("subcontractor_users")
        .update({
          full_name: existingIdentity?.full_name || data.fullName || null,
          phone: existingIdentity?.phone || data.phone || null,
        })
        .eq("id", identityId);
    }

    // Compte d'authentification : créé sans mot de passe (connexion par code).
    let authUserId = existingIdentity?.user_id ?? null;
    if (!authUserId) {
      const { data: createdUser, error: cuErr } = await supabaseAdmin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { subcontractor: true },
      });
      if (createdUser?.user?.id) {
        authUserId = createdUser.user.id;
      } else if (cuErr && !/already/i.test(cuErr.message)) {
        throw new Error("Création du compte impossible.");
      }
    }

    const permissions = resolvePermissions(data.preset, data.permissions);
    const nowIso = new Date().toISOString();

    const { data: existingMembership } = await supabaseAdmin
      .from("subcontractor_memberships")
      .select("id,status")
      .eq("company_id", data.companyId)
      .eq("subcontractor_company_id", data.subcontractorCompanyId)
      .eq("subcontractor_user_id", identityId!)
      .maybeSingle();

    let membershipId = existingMembership?.id ?? null;
    if (membershipId) {
      if (existingMembership?.status === "active") {
        throw new Error("Cette personne a déjà un accès actif pour ce sous-traitant.");
      }
      await supabaseAdmin
        .from("subcontractor_memberships")
        .update({
          status: "invited",
          permissions: permissions as never,
          preset: data.preset,
          job_title: data.jobTitle || null,
          invited_at: nowIso,
          revoked_at: null,
          suspended_at: null,
        })
        .eq("id", membershipId);
    } else {
      const { data: created, error } = await supabaseAdmin
        .from("subcontractor_memberships")
        .insert({
          company_id: data.companyId,
          subcontractor_company_id: data.subcontractorCompanyId,
          subcontractor_user_id: identityId!,
          job_title: data.jobTitle || null,
          status: "invited",
          preset: data.preset,
          permissions: permissions as never,
          invited_at: nowIso,
          created_by: userId,
        })
        .select("id")
        .single();
      if (error || !created) throw new Error("Invitation impossible.");
      membershipId = created.id;
    }

    if (authUserId) {
      await supabaseAdmin.from("subcontractor_users").update({ user_id: authUserId }).eq("id", identityId!);
    }

    // Jeton d'invitation : seul le HASH est stocké.
    const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    const tokenHash = await sha256Hex(token);
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86400_000).toISOString();

    await supabaseAdmin
      .from("subcontractor_invites")
      .update({ revoked_at: nowIso })
      .eq("membership_id", membershipId!)
      .is("used_at", null)
      .is("revoked_at", null);

    await supabaseAdmin.from("subcontractor_invites").insert({
      membership_id: membershipId!,
      company_id: data.companyId,
      email,
      token_hash: tokenHash,
      expires_at: expiresAt,
      created_by: userId,
    });

    const { data: company } = await supabaseAdmin
      .from("companies")
      .select("name")
      .eq("id", data.companyId)
      .maybeSingle();

    const inviteUrl = `${getPublicAppUrl()}/sous-traitant/invitation/${token}`;
    try {
      await sendSubcontractorInviteEmail({
        to: email,
        companyName: company?.name ?? "Votre donneur d'ordre",
        subcontractorCompanyName: sc.name,
        inviteUrl,
        expiresAt,
        companyId: data.companyId,
      });
    } catch {
      // L'invitation reste valide : l'admin peut la renvoyer.
    }

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "subcontractor",
      entityId: membershipId!,
      action: "member.invited" as never,
      metadata: { scope: "subcontractor", email, preset: data.preset },
    });

    return { ok: true as const, membershipId: membershipId! };
  });

export const revokeSubcontractorInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid(), membershipId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdminWrite(supabase, data.companyId, userId);
    await supabaseAdmin
      .from("subcontractor_invites")
      .update({ revoked_at: new Date().toISOString() })
      .eq("membership_id", data.membershipId)
      .eq("company_id", data.companyId)
      .is("used_at", null);
    return { ok: true as const };
  });

// ------------------------------------------------------ relations & droits

export const updateSubcontractorMembership = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        companyId: z.string().uuid(),
        membershipId: z.string().uuid(),
        jobTitle: z.string().trim().max(120).optional(),
        preset: PresetSchema,
        permissions: z.record(z.string(), z.boolean()).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdminWrite(supabase, data.companyId, userId);

    const permissions = resolvePermissions(data.preset, data.permissions);
    const { error } = await supabase
      .from("subcontractor_memberships")
      .update({
        job_title: data.jobTitle || null,
        preset: data.preset,
        permissions: permissions as never,
      })
      .eq("id", data.membershipId)
      .eq("company_id", data.companyId);
    if (error) throw new Error("Mise à jour impossible.");

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "subcontractor",
      entityId: data.membershipId,
      action: "member.role_changed" as never,
      metadata: {
        scope: "subcontractor",
        preset: data.preset,
        permissions: SUBCONTRACTOR_PERMISSIONS.filter((p) => permissions[p]),
      },
    });
    return { ok: true as const };
  });

export const setSubcontractorMembershipStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        companyId: z.string().uuid(),
        membershipId: z.string().uuid(),
        status: z.enum(["active", "suspended", "archived"]),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdminWrite(supabase, data.companyId, userId);
    const nowIso = new Date().toISOString();

    const { error } = await supabase
      .from("subcontractor_memberships")
      .update({
        status: data.status,
        suspended_at: data.status === "suspended" ? nowIso : null,
        revoked_at: data.status === "archived" ? nowIso : null,
      })
      .eq("id", data.membershipId)
      .eq("company_id", data.companyId);
    if (error) throw new Error("Mise à jour impossible.");

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "subcontractor",
      entityId: data.membershipId,
      action: (data.status === "active"
        ? "member.reactivated"
        : data.status === "suspended"
          ? "member.suspended"
          : "member.removed") as never,
      metadata: { scope: "subcontractor", status: data.status },
    });
    return { ok: true as const };
  });

// -------------------------------------------------------------- affectations

const AssignmentSchema = z.object({
  companyId: z.string().uuid(),
  id: z.string().uuid().optional(),
  chantierId: z.string().uuid(),
  membershipId: z.string().uuid(),
  technicalVisitId: z.string().uuid().nullable().optional(),
  mission: z.string().trim().min(1).max(60).default("travaux"),
  scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
  scheduledEndAt: z.string().datetime({ offset: true }).nullable().optional(),
  comment: z.string().trim().max(2000).optional().default(""),
  permissionOverrides: z.record(z.string(), z.boolean()).optional(),
  notify: z.boolean().optional().default(true),
});

export const saveSubcontractorAssignment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => AssignmentSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdminWrite(supabase, data.companyId, userId);

    const [{ data: chantier }, { data: membership }] = await Promise.all([
      supabase
        .from("chantiers")
        .select("id,reference,name,company_id")
        .eq("id", data.chantierId)
        .eq("company_id", data.companyId)
        .maybeSingle(),
      supabase
        .from("subcontractor_memberships")
        .select("id,status,company_id,subcontractor_user_id")
        .eq("id", data.membershipId)
        .eq("company_id", data.companyId)
        .maybeSingle(),
    ]);
    if (!chantier) throw new Error("Chantier introuvable.");
    if (!membership) throw new Error("Sous-traitant introuvable.");
    if (membership.status === "archived") throw new Error("Accès sous-traitant révoqué.");

    // Une visite technique ne peut être confiée que si la formule l'inclut.
    if (data.technicalVisitId) {
      const { assertPlanFeature } = await import("./plan-guard.server");
      await assertPlanFeature(data.companyId, "technical_visits" as never, userId);
      const { data: visit } = await supabase
        .from("technical_visits")
        .select("id,company_id")
        .eq("id", data.technicalVisitId)
        .eq("company_id", data.companyId)
        .maybeSingle();
      if (!visit) throw new Error("Visite technique introuvable.");
    }

    const payload = {
      company_id: data.companyId,
      chantier_id: data.chantierId,
      membership_id: data.membershipId,
      technical_visit_id: data.technicalVisitId ?? null,
      mission: data.mission,
      scheduled_at: data.scheduledAt ?? null,
      scheduled_end_at: data.scheduledEndAt ?? null,
      comment: data.comment || null,
      permission_overrides: normalizePermissions(data.permissionOverrides ?? {}) as never,
    };

    let id = data.id;
    if (id) {
      const { error } = await supabase
        .from("subcontractor_assignments")
        .update(payload)
        .eq("id", id)
        .eq("company_id", data.companyId);
      if (error) throw new Error("Mise à jour de l'intervention impossible.");
    } else {
      const { data: created, error } = await supabase
        .from("subcontractor_assignments")
        .insert({ ...payload, status: data.scheduledAt ? "planned" : "to_plan", created_by: userId })
        .select("id")
        .single();
      if (error || !created) throw new Error("Création de l'intervention impossible.");
      id = created.id;
    }

    if (data.notify && !data.id) {
      const { data: identity } = await supabaseAdmin
        .from("subcontractor_users")
        .select("email")
        .eq("id", membership.subcontractor_user_id)
        .maybeSingle();
      const { data: company } = await supabaseAdmin
        .from("companies")
        .select("name")
        .eq("id", data.companyId)
        .maybeSingle();
      if (identity?.email) {
        try {
          await sendSubcontractorAssignmentEmail({
            to: identity.email,
            companyName: company?.name ?? "PVIA",
            chantierLabel: `${chantier.reference ?? ""} ${chantier.name ?? ""}`.trim(),
            mission: data.mission,
            scheduledAt: data.scheduledAt ?? null,
            url: `${getPublicAppUrl()}/sous-traitant/intervention/${id}`,
            companyId: data.companyId,
          });
        } catch {}
      }
    }

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "subcontractor_assignment",
      entityId: id!,
      action: (data.id ? "member.role_changed" : "member.invited") as never,
      metadata: {
        scope: "subcontractor_assignment",
        chantierId: data.chantierId,
        membershipId: data.membershipId,
        mission: data.mission,
      },
    });

    return { ok: true as const, id: id! };
  });

export const cancelSubcontractorAssignment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid(), id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdminWrite(supabase, data.companyId, userId);
    const { error } = await supabase
      .from("subcontractor_assignments")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("company_id", data.companyId);
    if (error) throw new Error("Annulation impossible.");
    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "subcontractor_assignment",
      entityId: data.id,
      action: "member.removed" as never,
      metadata: { scope: "subcontractor_assignment", status: "cancelled" },
    });
    return { ok: true as const };
  });

/** Sous-traitants affectés à un chantier (onglet fiche chantier). */
export const listChantierSubcontractors = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid(), chantierId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, data.companyId, userId);
    const { data: rows } = await supabase
      .from("subcontractor_assignments")
      .select(
        "*, subcontractor_memberships!inner(id,job_title,status,subcontractor_companies!inner(id,name),subcontractor_users!inner(id,email,full_name,phone))",
      )
      .eq("company_id", data.companyId)
      .eq("chantier_id", data.chantierId)
      .order("scheduled_at", { ascending: true, nullsFirst: false });
    return { assignments: rows ?? [] };
  });

/** Planning global des interventions sous-traitantes (calendrier entreprise). */
export const listSubcontractorAgenda = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        companyId: z.string().uuid(),
        from: z.string().datetime({ offset: true }),
        to: z.string().datetime({ offset: true }),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, data.companyId, userId);
    const { data: rows } = await supabase
      .from("subcontractor_assignments")
      .select(
        "id,chantier_id,mission,status,scheduled_at,scheduled_end_at," +
          "chantiers!inner(id,reference,name)," +
          "subcontractor_memberships!inner(id,subcontractor_companies!inner(name),subcontractor_users!inner(full_name,email))",
      )
      .eq("company_id", data.companyId)
      .neq("status", "cancelled")
      .gte("scheduled_at", data.from)
      .lte("scheduled_at", data.to)
      .order("scheduled_at", { ascending: true });
    return { items: rows ?? [] };
  });

/** Message entreprise → sous-traitant sur une intervention. */
export const postSubcontractorMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        companyId: z.string().uuid(),
        assignmentId: z.string().uuid(),
        body: z.string().trim().min(1).max(4000),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, data.companyId, userId);
    const { assertSubscriptionUsable } = await import("./plan-guard.server");
    await assertSubscriptionUsable(data.companyId, userId);

    const { data: assignment } = await supabase
      .from("subcontractor_assignments")
      .select("id,company_id")
      .eq("id", data.assignmentId)
      .eq("company_id", data.companyId)
      .maybeSingle();
    if (!assignment) throw new Error("Intervention introuvable.");

    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", userId)
      .maybeSingle();

    const { error } = await supabaseAdmin.from("subcontractor_messages").insert({
      company_id: data.companyId,
      assignment_id: data.assignmentId,
      author_user_id: userId,
      author_kind: "company",
      author_label: profile?.full_name || "Entreprise",
      body: data.body,
    });
    if (error) throw new Error("Envoi impossible.");
    return { ok: true as const };
  });

export const listSubcontractorMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid(), assignmentId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, data.companyId, userId);
    const { data: rows } = await supabase
      .from("subcontractor_messages")
      .select("id,author_label,author_kind,body,created_at")
      .eq("company_id", data.companyId)
      .eq("assignment_id", data.assignmentId)
      .order("created_at", { ascending: true })
      .limit(200);
    return { messages: rows ?? [] };
  });

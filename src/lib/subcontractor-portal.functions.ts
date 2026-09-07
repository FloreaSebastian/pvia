/**
 * Espace Sous-traitant (côté sous-traitant connecté).
 *
 * Sécurité :
 * - aucune ressource n'est servie sur la foi d'un identifiant client : chaque
 *   accès passe par `requireAssignment` / `requireChantierAccess` qui relient
 *   la ressource à une affectation ACTIVE du compte connecté (anti-IDOR) ;
 * - une suspension/révocation coupe l'accès au prochain appel (aucun cache) ;
 * - les écritures respectent les gardes d'abonnement de l'entreprise
 *   donneuse d'ordre ;
 * - les données client sont réduites au strict minimum opérationnel.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { writeAuditLog } from "./audit.server";
import { enforceRateLimit } from "./rate-limit.server";
import {
  assertCompanyWritable,
  assertPermission,
  getSubcontractorIdentity,
  listActiveMemberships,
  requireAssignment,
  requireChantierAccess,
} from "./subcontractor-guard.server";
import { SUBCONTRACTOR_PERMISSIONS } from "./subcontractor-permissions";

const BUCKET = "pv-assets";

/** Le compte connecté est-il un sous-traitant ? (utilisé par la redirection UI) */
export const getSubcontractorContext = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const identity = await getSubcontractorIdentity(context.userId);
    const memberships = await listActiveMemberships(context.userId);
    return {
      isSubcontractor: !!identity,
      identity: identity
        ? { email: identity.email, fullName: identity.full_name, phone: identity.phone }
        : null,
      memberships: memberships.map((m) => ({
        membershipId: m.membershipId,
        companyId: m.companyId,
        companyName: m.companyName,
        subcontractorCompanyName: m.subcontractorCompanyName,
        jobTitle: m.jobTitle,
        permissions: m.permissions,
      })),
    };
  });

/** Planning + interventions du sous-traitant, toutes entreprises confondues. */
export const getSubcontractorWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const memberships = await listActiveMemberships(context.userId);
    if (memberships.length === 0) return { memberships: [], assignments: [] };

    const { data } = await supabaseAdmin
      .from("subcontractor_assignments")
      .select(
        "id,company_id,chantier_id,membership_id,mission,status,scheduled_at,scheduled_end_at,comment," +
          "chantiers!inner(id,reference,name,address,city,postal_code)",
      )
      .in(
        "membership_id",
        memberships.map((m) => m.membershipId),
      )
      .neq("status", "cancelled")
      .order("scheduled_at", { ascending: true, nullsFirst: false })
      .limit(300);

    const byCompany = new Map(memberships.map((m) => [m.companyId, m]));
    const assignments = ((data ?? []) as any[]).map((a) => ({
      id: a.id as string,
      companyId: a.company_id as string,
      companyName: byCompany.get(a.company_id)?.companyName ?? "",
      chantierId: a.chantier_id as string,
      chantier: a.chantiers,
      mission: a.mission as string,
      status: a.status as string,
      scheduledAt: a.scheduled_at as string | null,
      scheduledEndAt: a.scheduled_end_at as string | null,
      comment: a.comment as string | null,
    }));

    return {
      memberships: memberships.map((m) => ({
        membershipId: m.membershipId,
        companyId: m.companyId,
        companyName: m.companyName,
        subcontractorCompanyName: m.subcontractorCompanyName,
        jobTitle: m.jobTitle,
        permissions: m.permissions,
      })),
      assignments,
    };
  });

/** Détail complet d'une intervention (filtré par permissions effectives). */
export const getSubcontractorAssignment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ assignmentId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { assignment, membership, permissions } = await requireAssignment(
      context.userId,
      data.assignmentId,
    );

    const { data: chantier } = await supabaseAdmin
      .from("chantiers")
      .select("id,reference,name,address,address_line1,postal_code,city,description,status,client_id")
      .eq("id", assignment.chantier_id)
      .maybeSingle();

    // Données client strictement minimales, et seulement si autorisé.
    let client: { name: string; phone: string | null } | null = null;
    if (permissions["client.contact.view"] && chantier?.client_id) {
      const { data: c } = await supabaseAdmin
        .from("clients")
        .select("name,phone")
        .eq("id", chantier.client_id)
        .maybeSingle();
      if (c) client = { name: c.name, phone: c.phone ?? null };
    }

    const photos: any[] = [];
    if (permissions["chantier.photos.view"]) {
      const { data: rows } = await supabaseAdmin
        .from("chantier_photos")
        .select("id,label,photo_type,caption,storage_path,taken_at,created_at")
        .eq("chantier_id", assignment.chantier_id)
        .order("created_at", { ascending: false })
        .limit(120);
      for (const r of rows ?? []) {
        let url: string | null = null;
        if (r.storage_path) {
          const { data: signed } = await supabaseAdmin.storage
            .from(BUCKET)
            .createSignedUrl(r.storage_path, 3600);
          url = signed?.signedUrl ?? null;
        }
        photos.push({ ...r, signed_url: url });
      }
    }

    let documents: any[] = [];
    if (permissions["chantier.documents.view"]) {
      const { data: rows } = await supabaseAdmin
        .from("chantier_documents")
        .select("id,name,category,file_type,storage_path,created_at")
        .eq("chantier_id", assignment.chantier_id)
        .order("created_at", { ascending: false })
        .limit(80);
      documents = [];
      for (const r of rows ?? []) {
        let url: string | null = null;
        if (r.storage_path) {
          const { data: signed } = await supabaseAdmin.storage
            .from(BUCKET)
            .createSignedUrl(r.storage_path, 3600);
          url = signed?.signedUrl ?? null;
        }
        documents.push({ ...r, signed_url: url });
      }
    }

    let reserves: any[] = [];
    if (permissions["reserve.view"]) {
      const { data: pvs } = await supabaseAdmin
        .from("pv")
        .select("id")
        .eq("chantier_id", assignment.chantier_id);
      const pvIds = (pvs ?? []).map((p) => p.id);
      if (pvIds.length) {
        const { data: rows } = await supabaseAdmin
          .from("pv_reserves")
          .select("id,description,severity,status,priority,work_to_execute,due_date,created_at")
          .in("pv_id", pvIds)
          .order("created_at", { ascending: false })
          .limit(200);
        reserves = rows ?? [];
      }
    }

    let visit: any = null;
    if (permissions["visit.view"] && assignment.technical_visit_id) {
      const { data: v } = await supabaseAdmin
        .from("technical_visits")
        .select("id,status,scheduled_at,notes")
        .eq("id", assignment.technical_visit_id)
        .maybeSingle();
      visit = v ?? null;
    }

    let messages: any[] = [];
    if (permissions["assignment.message"]) {
      const { data: rows } = await supabaseAdmin
        .from("subcontractor_messages")
        .select("id,author_label,author_kind,body,created_at")
        .eq("assignment_id", assignment.id)
        .order("created_at", { ascending: true })
        .limit(200);
      messages = rows ?? [];
    }

    return {
      assignment,
      companyName: membership.companyName,
      permissions,
      chantier: chantier
        ? {
            id: chantier.id,
            reference: chantier.reference,
            name: chantier.name,
            address: permissions["chantier.details"] ? chantier.address : null,
            city: chantier.city,
            postal_code: chantier.postal_code,
            description: permissions["chantier.details"] ? chantier.description : null,
            status: chantier.status,
          }
        : null,
      client,
      photos,
      documents,
      reserves,
      visit,
      messages,
    };
  });

const STATUS = z.enum(["confirmed", "en_route", "on_site", "in_progress", "done"]);

export const setSubcontractorAssignmentStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ assignmentId: z.string().uuid(), status: STATUS }).parse(i))
  .handler(async ({ data, context }) => {
    const { assignment, membership, permissions } = await requireAssignment(
      context.userId,
      data.assignmentId,
    );
    assertPermission(permissions, "assignment.status_update");
    await assertCompanyWritable(assignment.company_id);

    const nowIso = new Date().toISOString();
    const patch = {
      status: data.status,
      ...(data.status === "confirmed" ? { confirmed_at: nowIso } : {}),
      ...(data.status === "in_progress" || data.status === "on_site" ? { started_at: nowIso } : {}),
      ...(data.status === "done" ? { completed_at: nowIso } : {}),
    };

    const { error } = await supabaseAdmin
      .from("subcontractor_assignments")
      .update(patch)
      .eq("id", assignment.id);
    if (error) throw new Error("Mise à jour impossible.");

    await supabaseAdmin
      .from("subcontractor_memberships")
      .update({ last_activity_at: nowIso })
      .eq("id", membership.membershipId);

    await supabaseAdmin.from("notifications").insert({
      company_id: assignment.company_id,
      type: "info",
      title: "Intervention sous-traitant mise à jour",
      body: `${membership.subcontractorCompanyName} — statut : ${data.status}`,
    } as never);

    await writeAuditLog({
      companyId: assignment.company_id,
      userId: context.userId,
      entityType: "subcontractor_assignment",
      entityId: assignment.id,
      action: "member.role_changed" as never,
      metadata: { scope: "subcontractor_assignment_status", status: data.status },
    });

    return { ok: true as const };
  });

export const sendSubcontractorMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ assignmentId: z.string().uuid(), body: z.string().trim().min(1).max(4000) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { assignment, membership, permissions } = await requireAssignment(
      context.userId,
      data.assignmentId,
    );
    assertPermission(permissions, "assignment.message");
    await assertCompanyWritable(assignment.company_id);
    await enforceRateLimit({
      bucket: "subcontractor_message",
      key: context.userId,
      limit: 60,
      windowSec: 3600,
    });

    const { error } = await supabaseAdmin.from("subcontractor_messages").insert({
      company_id: assignment.company_id,
      assignment_id: assignment.id,
      author_user_id: context.userId,
      author_kind: "subcontractor",
      author_label: membership.subcontractorCompanyName || "Sous-traitant",
      body: data.body,
    });
    if (error) throw new Error("Envoi impossible.");
    return { ok: true as const };
  });

export const addSubcontractorNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ assignmentId: z.string().uuid(), note: z.string().trim().min(1).max(4000) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { assignment, membership, permissions } = await requireAssignment(
      context.userId,
      data.assignmentId,
    );
    assertPermission(permissions, "chantier.notes.add");
    await assertCompanyWritable(assignment.company_id);

    const { error } = await supabaseAdmin.from("chantier_notes").insert({
      company_id: assignment.company_id,
      chantier_id: assignment.chantier_id,
      note: `[Sous-traitant · ${membership.subcontractorCompanyName}] ${data.note}`,
      visibility: "internal",
      priority: "normal",
      created_by: null,
    } as never);
    if (error) throw new Error("Enregistrement impossible.");

    await writeAuditLog({
      companyId: assignment.company_id,
      userId: context.userId,
      entityType: "chantier_note",
      entityId: assignment.chantier_id,
      action: "chantier.note_added" as never,
      metadata: { scope: "subcontractor", membershipId: membership.membershipId },
    });
    return { ok: true as const };
  });

/**
 * Photo terrain : l'upload transite par le serveur (le sous-traitant n'a
 * aucun droit d'écriture direct sur le stockage).
 */
export const uploadSubcontractorPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        assignmentId: z.string().uuid(),
        fileName: z.string().max(200),
        contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
        dataBase64: z.string().min(32).max(9_000_000),
        caption: z.string().trim().max(500).optional().default(""),
        photoType: z.enum(["before", "during", "after"]).default("during"),
        latitude: z.number().nullable().optional(),
        longitude: z.number().nullable().optional(),
        takenAt: z.string().datetime({ offset: true }).nullable().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { assignment, membership, permissions } = await requireAssignment(
      context.userId,
      data.assignmentId,
    );
    assertPermission(permissions, "chantier.photos.add");
    await assertCompanyWritable(assignment.company_id);
    await enforceRateLimit({
      bucket: "subcontractor_photo_upload",
      key: context.userId,
      limit: 120,
      windowSec: 3600,
    });

    const bytes = Uint8Array.from(atob(data.dataBase64), (c) => c.charCodeAt(0));
    if (bytes.byteLength > 6_000_000) throw new Error("Photo trop volumineuse (6 Mo max).");

    const ext = data.contentType === "image/png" ? "png" : data.contentType === "image/webp" ? "webp" : "jpg";
    const path = `${assignment.company_id}/chantiers/${assignment.chantier_id}/subcontractor/${crypto.randomUUID()}.${ext}`;

    const { error: upErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: data.contentType, upsert: false });
    if (upErr) throw new Error("Envoi de la photo impossible.");

    const { data: label } = await supabaseAdmin.rpc("next_chantier_photo_label", {
      _chantier_id: assignment.chantier_id,
      _photo_type: data.photoType,
    });

    const { error } = await supabaseAdmin.from("chantier_photos").insert({
      company_id: assignment.company_id,
      chantier_id: assignment.chantier_id,
      uploaded_by: null,
      photo_type: data.photoType,
      storage_path: path,
      label: (label as unknown as string) ?? "ST-1",
      caption: `[${membership.subcontractorCompanyName}] ${data.caption}`.trim(),
      latitude: data.latitude ?? null,
      longitude: data.longitude ?? null,
      taken_at: data.takenAt ?? new Date().toISOString(),
      file_name: data.fileName,
      file_size: bytes.byteLength,
    } as never);
    if (error) {
      await supabaseAdmin.storage.from(BUCKET).remove([path]);
      throw new Error("Enregistrement de la photo impossible.");
    }

    await writeAuditLog({
      companyId: assignment.company_id,
      userId: context.userId,
      entityType: "chantier_photo",
      entityId: assignment.chantier_id,
      action: "photo.add" as never,
      metadata: { scope: "subcontractor", membershipId: membership.membershipId },
    });

    return { ok: true as const };
  });

/** Visite technique : réponses terrain, uniquement si la formule l'autorise. */
export const saveSubcontractorVisitAnswer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        assignmentId: z.string().uuid(),
        sectionKey: z.string().min(1).max(80),
        fieldKey: z.string().min(1).max(80),
        value: z.unknown(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { assignment, permissions } = await requireAssignment(context.userId, data.assignmentId);
    assertPermission(permissions, "visit.fill");
    if (!assignment.technical_visit_id) throw new Error("Aucune visite technique rattachée.");
    await assertCompanyWritable(assignment.company_id);
    const { assertPlanFeature } = await import("./plan-guard.server");
    await assertPlanFeature(assignment.company_id, "technical_visits");

    const { error } = await supabaseAdmin.from("technical_visit_answers").upsert(
      {
        visit_id: assignment.technical_visit_id,
        company_id: assignment.company_id,
        section_key: data.sectionKey,
        field_key: data.fieldKey,
        value: (data.value ?? null) as never,
      } as never,
      { onConflict: "visit_id,section_key,field_key" },
    );
    if (error) throw new Error("Enregistrement impossible.");
    return { ok: true as const };
  });

/** Accès chantier direct (liste des interventions du sous-traitant dessus). */
export const getSubcontractorChantier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ chantierId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { membership, permissions, assignmentIds } = await requireChantierAccess(
      context.userId,
      data.chantierId,
    );
    assertPermission(permissions, "chantier.view");
    const { data: chantier } = await supabaseAdmin
      .from("chantiers")
      .select("id,reference,name,address,city,postal_code,status,description")
      .eq("id", data.chantierId)
      .maybeSingle();
    return {
      chantier,
      companyName: membership.companyName,
      assignmentIds,
      permissions: SUBCONTRACTOR_PERMISSIONS.filter((p) => permissions[p]),
    };
  });

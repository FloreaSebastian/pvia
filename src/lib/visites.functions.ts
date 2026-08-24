/**
 * Visites techniques — server functions.
 * Fichier « thin wrapper » : uniquement des imports et des déclarations de server functions.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { writeAuditLog } from "./audit.server";
import {
  AnswerEntrySchema,
  ConstraintPayloadSchema,
  CreateVisitSchema,
  PhotoSkipReasonSchema,
  VisitFiltersSchema,
  VisitPhotoPayloadSchema,
  VisitPlanningSchema,
  VisitStatusSchema,
  VisitTypeSchema,
} from "./visites/schemas";
import {
  assertCanEditVisit,
  assertCanManage,
  assertIsMember,
  assertTransition,
  buildChantierName,
  composeAddress,
  findChantierDuplicates,
  loadVisitScoped,
  normalizeAddressKey,
  refreshVisitCompletion,
  signVisitPhotos,
  VISIT_BUCKET,
} from "./visites.server";

/** Liste paginée + compteurs KPI. */
export const listTechnicalVisits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => VisitFiltersSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertIsMember(supabase, data.companyId, userId);

    let q = supabase
      .from("technical_visits")
      .select(
        "id,reference,visit_type,status,scheduled_at,completed_at,validated_at,completion_percent,assigned_to,created_at," +
          "chantier:chantiers(id,reference,name,address,city,postal_code),client:clients(id,name,company_name,client_type)",
        { count: "exact" },
      )
      .eq("company_id", data.companyId);

    if (!data.include_archived) q = q.neq("status", "archivee");
    if (data.visit_type) q = q.eq("visit_type", data.visit_type);
    if (data.status) q = q.eq("status", data.status);
    if (data.assigned_to) q = q.eq("assigned_to", data.assigned_to);
    if (data.chantier_id) q = q.eq("chantier_id", data.chantier_id);
    if (data.client_id) q = q.eq("client_id", data.client_id);
    if (data.from) q = q.gte("scheduled_at", `${data.from}T00:00:00Z`);
    if (data.to) q = q.lte("scheduled_at", `${data.to}T23:59:59Z`);

    const { data: rows, error, count } = await q
      .order("scheduled_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .range(data.offset, data.offset + data.limit - 1);
    if (error) throw new Error(error.message);

    const term = data.search.trim().toLowerCase();
    const filtered = !term
      ? rows ?? []
      : (rows ?? []).filter((r: any) => {
          const hay = [
            r.reference,
            r.chantier?.name,
            r.chantier?.reference,
            r.chantier?.address,
            r.chantier?.city,
            r.client?.name,
            r.client?.company_name,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return hay.includes(term);
        });

    const { data: kpiRows } = await supabase
      .from("technical_visits")
      .select("status,scheduled_at")
      .eq("company_id", data.companyId)
      .neq("status", "archivee")
      .limit(5000);
    const today = new Date().toISOString().slice(0, 10);
    const kpis = {
      total: (kpiRows ?? []).length,
      a_planifier: (kpiRows ?? []).filter((r) => r.status === "a_planifier").length,
      aujourdhui: (kpiRows ?? []).filter((r) => (r.scheduled_at ?? "").slice(0, 10) === today).length,
      en_cours: (kpiRows ?? []).filter((r) => r.status === "en_cours" || r.status === "a_completer").length,
      a_valider: (kpiRows ?? []).filter((r) => r.status === "terminee").length,
    };

    return {
      visits: filtered,
      total: count ?? filtered.length,
      hasMore: (count ?? 0) > data.offset + data.limit,
      kpis,
    };
  });

/** Visites d'un chantier (onglet de la fiche chantier). */
export const listChantierTechnicalVisits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid(), chantierId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertIsMember(supabase, data.companyId, userId);
    const { data: rows, error } = await supabase
      .from("technical_visits")
      .select("id,reference,visit_type,status,scheduled_at,completed_at,validated_at,completion_percent,assigned_to,created_at")
      .eq("company_id", data.companyId)
      .eq("chantier_id", data.chantierId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { visits: rows ?? [] };
  });

/** Dossier complet d'une visite : réponses, photos signées, motifs, contraintes. */
export const getTechnicalVisit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid(), visitId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertIsMember(supabase, data.companyId, userId);

    const { data: visitRow, error } = await supabase
      .from("technical_visits")
      .select(
        "*,chantier:chantiers(id,reference,name,address,address_line1,postal_code,city,status,type)," +
          "client:clients(id,name,company_name,client_type,email,phone,address)",
      )
      .eq("id", data.visitId)
      .eq("company_id", data.companyId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!visitRow) throw new Error("Visite introuvable.");
    const visit = visitRow as unknown as Record<string, any>;

    const [answersRes, photosRes, skipsRes, constraintsRes, editableRes] = await Promise.all([
      supabase.from("technical_visit_answers").select("section_key,field_key,value").eq("visit_id", data.visitId),
      supabase
        .from("technical_visit_photos")
        .select("id,section_key,slot_key,storage_path,caption,comment,latitude,longitude,taken_at,file_name,created_at,uploaded_by")
        .eq("visit_id", data.visitId)
        .order("created_at", { ascending: true }),
      supabase.from("technical_visit_photo_skips").select("id,section_key,slot_key,reason,justification").eq("visit_id", data.visitId),
      supabase
        .from("technical_visit_constraints")
        .select("id,section_key,category,level,title,description,recommendation,created_at")
        .eq("visit_id", data.visitId)
        .order("created_at", { ascending: true }),
      supabase.rpc("can_edit_technical_visit", { _visit_id: data.visitId, _user_id: userId }),
    ]);

    const answers: Record<string, any> = {};
    for (const a of answersRes.data ?? []) answers[a.field_key] = a.value;

    let assigneeName: string | null = null;
    if (visit.assigned_to) {
      const { data: prof } = await supabase.from("profiles").select("full_name").eq("id", visit.assigned_to).maybeSingle();
      assigneeName = prof?.full_name ?? null;
    }

    return {
      visit,
      answers,
      photos: await signVisitPhotos(supabase, photosRes.data ?? []),
      skips: skipsRes.data ?? [],
      constraints: constraintsRes.data ?? [],
      assigneeName,
      canEdit: editableRes.data === true,
    };
  });

/** Détection de doublon avant création (appelée par l'étape Chantier du wizard). */
export const findVisitChantierDuplicates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        companyId: z.string().uuid(),
        clientId: z.string().uuid(),
        visit_type: VisitTypeSchema,
        address_line1: z.string().max(300).optional().default(""),
        postal_code: z.string().max(20).optional().default(""),
        city: z.string().max(150).optional().default(""),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertIsMember(supabase, data.companyId, userId);
    const duplicates = await findChantierDuplicates(supabase, data.companyId, data.clientId, data.visit_type, data);
    return { duplicates };
  });

/**
 * Création atomique de la visite (+ chantier auto si nécessaire + événement calendrier).
 * Idempotent via idempotency_key : une double soumission renvoie la visite existante.
 */
export const createTechnicalVisit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => CreateVisitSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCanManage(supabase, data.companyId, userId);

    const { data: existing } = await supabase
      .from("technical_visits")
      .select("id,reference,chantier_id")
      .eq("company_id", data.companyId)
      .eq("idempotency_key", data.idempotency_key)
      .maybeSingle();
    if (existing) {
      return { ok: true as const, id: existing.id, reference: existing.reference, chantierId: existing.chantier_id, duplicates: [], reused: true };
    }

    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select("id,name,company_name,client_type,address,address_line1,postal_code,city,latitude,longitude")
      .eq("id", data.client_id)
      .eq("company_id", data.companyId)
      .maybeSingle();
    if (clientErr) throw new Error("Lecture du client impossible.");
    if (!client) throw new Error("Client introuvable.");

    let chantierId = data.chantier_id ?? null;
    let chantierCreated = false;

    if (!chantierId) {
      const nc = data.new_chantier ?? { name: "", address_line1: "", postal_code: "", city: "" };
      const address = {
        address_line1: nc.address_line1 || client.address_line1 || "",
        postal_code: nc.postal_code || client.postal_code || "",
        city: nc.city || client.city || "",
      };

      if (!data.force_new_chantier) {
        const duplicates = await findChantierDuplicates(supabase, data.companyId, client.id, data.visit_type, address);
        if (duplicates.length > 0) {
          return { ok: false as const, reason: "duplicate_chantier" as const, duplicates };
        }
      }

      const clientLabel = client.client_type === "professionnel" ? client.company_name || client.name : client.name;
      const { data: created, error: chErr } = await supabase
        .from("chantiers")
        .insert({
          company_id: data.companyId,
          owner_id: userId,
          client_id: client.id,
          name: (nc.name || buildChantierName(data.visit_type, clientLabel ?? "")).slice(0, 200),
          type: (await import("./visites/templates")).getVisitTemplate(data.visit_type).chantierType,
          status: "preparation",
          address: composeAddress(address.address_line1, address.postal_code, address.city) ?? client.address ?? null,
          address_line1: address.address_line1 || null,
          postal_code: address.postal_code || null,
          city: address.city || null,
          latitude: nc.latitude ?? client.latitude ?? null,
          longitude: nc.longitude ?? client.longitude ?? null,
        } as never)
        .select("id,reference,name")
        .single();
      if (chErr || !created) throw new Error(chErr?.message ?? "Création du chantier impossible.");
      chantierId = created.id;
      chantierCreated = true;
      await writeAuditLog({
        companyId: data.companyId,
        userId,
        entityType: "chantier",
        entityId: created.id,
        action: "chantier.create",
        newValues: { name: created.name, reference: created.reference },
        metadata: { source: "visite_technique", visit_type: data.visit_type },
      });
    } else {
      const { data: ch } = await supabase
        .from("chantiers")
        .select("id")
        .eq("id", chantierId)
        .eq("company_id", data.companyId)
        .maybeSingle();
      if (!ch) throw new Error("Chantier introuvable.");
    }

    const planning = VisitPlanningSchema.parse(data.planning ?? {});
    const { data: chantierRow } = await supabase
      .from("chantiers")
      .select("address,name")
      .eq("id", chantierId)
      .maybeSingle();

    const { data: visit, error: vErr } = await supabase
      .from("technical_visits")
      .insert({
        company_id: data.companyId,
        chantier_id: chantierId,
        client_id: client.id,
        visit_type: data.visit_type,
        status: planning.scheduled_at ? "planifiee" : "a_planifier",
        assigned_to: planning.assigned_to ?? null,
        scheduled_at: planning.scheduled_at ?? null,
        site_contact_name: planning.site_contact_name || null,
        site_contact_phone: planning.site_contact_phone || null,
        site_address: chantierRow?.address ?? null,
        prep_notes: planning.prep_notes || null,
        created_by: userId,
        idempotency_key: data.idempotency_key,
      } as never)
      .select("id,reference")
      .single();
    if (vErr || !visit) {
      if (vErr?.code === "23505") {
        const { data: race } = await supabase
          .from("technical_visits")
          .select("id,reference,chantier_id")
          .eq("company_id", data.companyId)
          .eq("idempotency_key", data.idempotency_key)
          .maybeSingle();
        if (race) {
          return { ok: true as const, id: race.id, reference: race.reference, chantierId: race.chantier_id, duplicates: [], reused: true };
        }
      }
      throw new Error(vErr?.message ?? "Création de la visite impossible.");
    }

    if (planning.scheduled_at) {
      const template = (await import("./visites/templates")).getVisitTemplate(data.visit_type);
      const start = new Date(planning.scheduled_at);
      const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
      const { data: event } = await supabase
        .from("chantier_events")
        .insert({
          company_id: data.companyId,
          chantier_id: chantierId,
          client_id: client.id,
          title: `Visite technique ${template.label} — ${visit.reference}`,
          description: planning.prep_notes || null,
          event_type: "visite_technique",
          status: "planifie",
          start_at: start.toISOString(),
          end_at: end.toISOString(),
          all_day: false,
          assigned_to: planning.assigned_to ?? null,
          location: chantierRow?.address ?? null,
          created_by: userId,
        } as never)
        .select("id")
        .maybeSingle();
      if (event?.id) await supabase.from("technical_visits").update({ calendar_event_id: event.id }).eq("id", visit.id);
    }

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "technical_visit",
      entityId: visit.id,
      action: "visite.create",
      newValues: { reference: visit.reference, visit_type: data.visit_type, chantier_id: chantierId },
      metadata: { chantier_created: chantierCreated, scheduled_at: planning.scheduled_at ?? null },
    });

    return { ok: true as const, id: visit.id, reference: visit.reference, chantierId, chantierCreated, duplicates: [], reused: false };
  });

/** Mise à jour de la planification / du contexte de la visite. */
export const updateTechnicalVisit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ companyId: z.string().uuid(), visitId: z.string().uuid(), planning: VisitPlanningSchema }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCanManage(supabase, data.companyId, userId);
    const prev = await loadVisitScoped(supabase, data.companyId, data.visitId);
    if (prev.status === "archivee") throw new Error("Visite archivée : modification impossible.");

    const patch = {
      assigned_to: data.planning.assigned_to ?? null,
      scheduled_at: data.planning.scheduled_at ?? null,
      site_contact_name: data.planning.site_contact_name || null,
      site_contact_phone: data.planning.site_contact_phone || null,
      prep_notes: data.planning.prep_notes || null,
      status: prev.status === "a_planifier" && data.planning.scheduled_at ? "planifiee" : prev.status,
    };
    const { error } = await supabase.from("technical_visits").update(patch as never).eq("id", data.visitId).eq("company_id", data.companyId);
    if (error) throw new Error(error.message);

    if (prev.calendar_event_id && patch.scheduled_at) {
      const start = new Date(patch.scheduled_at);
      await supabase
        .from("chantier_events")
        .update({
          start_at: start.toISOString(),
          end_at: new Date(start.getTime() + 2 * 60 * 60 * 1000).toISOString(),
          assigned_to: patch.assigned_to,
        } as never)
        .eq("id", prev.calendar_event_id)
        .eq("company_id", data.companyId);
    }

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "technical_visit",
      entityId: data.visitId,
      action: "visite.update",
      oldValues: { assigned_to: prev.assigned_to, scheduled_at: prev.scheduled_at },
      newValues: patch,
    });
    return { ok: true };
  });

/** Enregistrement des réponses (autosave terrain). Recalcule la complétude. */
export const saveVisitAnswers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        companyId: z.string().uuid(),
        visitId: z.string().uuid(),
        entries: z.array(AnswerEntrySchema).min(1).max(400),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const visit = await assertCanEditVisit(supabase, data.companyId, data.visitId, userId);

    const rows = data.entries.map((e) => ({
      visit_id: data.visitId,
      company_id: data.companyId,
      section_key: e.section_key,
      field_key: e.field_key,
      value: e.value,
    }));
    const { error } = await supabase
      .from("technical_visit_answers")
      .upsert(rows as never, { onConflict: "visit_id,field_key" });
    if (error) throw new Error(error.message);

    const patch: Record<string, unknown> = {};
    if (visit.status === "planifiee" || visit.status === "a_planifier") {
      patch.status = "en_cours";
      patch.started_at = visit.started_at ?? new Date().toISOString();
    }
    if (Object.keys(patch).length) {
      await supabase.from("technical_visits").update(patch as never).eq("id", data.visitId);
      await writeAuditLog({
        companyId: data.companyId,
        userId,
        entityType: "technical_visit",
        entityId: data.visitId,
        action: "visite.started",
      });
    }

    const percent = await refreshVisitCompletion(supabase, data.visitId);
    return { ok: true, completion_percent: percent };
  });

/** Métadonnées d'une photo après upload direct dans le stockage. */
export const addVisitPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ companyId: z.string().uuid(), visitId: z.string().uuid(), photo: VisitPhotoPayloadSchema }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCanEditVisit(supabase, data.companyId, data.visitId, userId);
    if (!data.photo.storage_path.startsWith(`${data.companyId}/visites/${data.visitId}/`)) {
      throw new Error("Chemin de stockage invalide.");
    }

    const { data: row, error } = await supabase
      .from("technical_visit_photos")
      .insert({
        visit_id: data.visitId,
        company_id: data.companyId,
        section_key: data.photo.section_key,
        slot_key: data.photo.slot_key,
        storage_path: data.photo.storage_path,
        caption: data.photo.caption ?? null,
        comment: data.photo.comment ?? null,
        latitude: data.photo.latitude ?? null,
        longitude: data.photo.longitude ?? null,
        accuracy: data.photo.accuracy ?? null,
        taken_at: data.photo.taken_at ?? null,
        exif_metadata: data.photo.exif_metadata ?? null,
        file_hash: data.photo.file_hash ?? null,
        file_name: data.photo.file_name ?? null,
        file_size: data.photo.file_size ?? null,
        uploaded_by: userId,
      } as never)
      .select("id,storage_path,slot_key,section_key,caption,comment,created_at,taken_at,latitude,longitude,file_name,uploaded_by")
      .single();
    if (error || !row) throw new Error(error?.message ?? "Enregistrement de la photo impossible.");

    await supabase.from("technical_visit_photo_skips").delete().eq("visit_id", data.visitId).eq("slot_key", data.photo.slot_key);

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "technical_visit",
      entityId: data.visitId,
      action: "visite.photo_added",
      metadata: { slot_key: data.photo.slot_key, section_key: data.photo.section_key },
    });

    const [signed] = await signVisitPhotos(supabase, [row]);
    const percent = await refreshVisitCompletion(supabase, data.visitId);
    return { ok: true, photo: signed, completion_percent: percent };
  });

export const deleteVisitPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid(), visitId: z.string().uuid(), photoId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCanEditVisit(supabase, data.companyId, data.visitId, userId);
    const { data: photo } = await supabase
      .from("technical_visit_photos")
      .select("id,storage_path,slot_key")
      .eq("id", data.photoId)
      .eq("visit_id", data.visitId)
      .eq("company_id", data.companyId)
      .maybeSingle();
    if (!photo) throw new Error("Photo introuvable.");

    const { error } = await supabase.from("technical_visit_photos").delete().eq("id", data.photoId).eq("company_id", data.companyId);
    if (error) throw new Error(error.message);
    await supabase.storage.from(VISIT_BUCKET).remove([photo.storage_path]);

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "technical_visit",
      entityId: data.visitId,
      action: "visite.photo_deleted",
      metadata: { slot_key: photo.slot_key },
    });
    const percent = await refreshVisitCompletion(supabase, data.visitId);
    return { ok: true, completion_percent: percent };
  });

/** « Impossible à photographier » : motif obligatoire. */
export const skipVisitPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        companyId: z.string().uuid(),
        visitId: z.string().uuid(),
        section_key: z.string().min(1).max(80),
        slot_key: z.string().min(1).max(160),
        reason: PhotoSkipReasonSchema,
        justification: z.string().trim().min(3, "Justification requise.").max(1000),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCanEditVisit(supabase, data.companyId, data.visitId, userId);
    const { error } = await supabase
      .from("technical_visit_photo_skips")
      .upsert(
        {
          visit_id: data.visitId,
          company_id: data.companyId,
          section_key: data.section_key,
          slot_key: data.slot_key,
          reason: data.reason,
          justification: data.justification,
          created_by: userId,
        } as never,
        { onConflict: "visit_id,slot_key" },
      );
    if (error) throw new Error(error.message);
    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "technical_visit",
      entityId: data.visitId,
      action: "visite.photo_skipped",
      metadata: { slot_key: data.slot_key, reason: data.reason },
    });
    const percent = await refreshVisitCompletion(supabase, data.visitId);
    return { ok: true, completion_percent: percent };
  });

export const removeVisitPhotoSkip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid(), visitId: z.string().uuid(), slot_key: z.string().min(1).max(160) }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCanEditVisit(supabase, data.companyId, data.visitId, userId);
    const { error } = await supabase
      .from("technical_visit_photo_skips")
      .delete()
      .eq("visit_id", data.visitId)
      .eq("company_id", data.companyId)
      .eq("slot_key", data.slot_key);
    if (error) throw new Error(error.message);
    const percent = await refreshVisitCompletion(supabase, data.visitId);
    return { ok: true, completion_percent: percent };
  });

/** Création ou mise à jour d'une contrainte. */
export const saveVisitConstraint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ companyId: z.string().uuid(), visitId: z.string().uuid(), constraint: ConstraintPayloadSchema }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCanEditVisit(supabase, data.companyId, data.visitId, userId);
    const c = data.constraint;
    const payload = {
      visit_id: data.visitId,
      company_id: data.companyId,
      section_key: c.section_key ?? null,
      category: c.category,
      level: c.level,
      title: c.title,
      description: c.description || null,
      recommendation: c.recommendation || null,
      created_by: userId,
    };

    if (c.id) {
      const { error } = await supabase
        .from("technical_visit_constraints")
        .update(payload as never)
        .eq("id", c.id)
        .eq("visit_id", data.visitId)
        .eq("company_id", data.companyId);
      if (error) throw new Error(error.message);
      await writeAuditLog({
        companyId: data.companyId,
        userId,
        entityType: "technical_visit",
        entityId: data.visitId,
        action: "visite.constraint_updated",
        metadata: { constraint_id: c.id, level: c.level },
      });
      await refreshVisitCompletion(supabase, data.visitId);
      return { ok: true, id: c.id };
    }

    const { data: row, error } = await supabase
      .from("technical_visit_constraints")
      .insert(payload as never)
      .select("id")
      .single();
    if (error || !row) throw new Error(error?.message ?? "Enregistrement de la contrainte impossible.");
    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "technical_visit",
      entityId: data.visitId,
      action: "visite.constraint_added",
      metadata: { constraint_id: row.id, level: c.level, category: c.category },
    });
    await refreshVisitCompletion(supabase, data.visitId);
    return { ok: true, id: row.id as string };
  });

export const deleteVisitConstraint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid(), visitId: z.string().uuid(), constraintId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCanEditVisit(supabase, data.companyId, data.visitId, userId);
    const { error } = await supabase
      .from("technical_visit_constraints")
      .delete()
      .eq("id", data.constraintId)
      .eq("visit_id", data.visitId)
      .eq("company_id", data.companyId);
    if (error) throw new Error(error.message);
    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "technical_visit",
      entityId: data.visitId,
      action: "visite.constraint_deleted",
      metadata: { constraint_id: data.constraintId },
    });
    return { ok: true };
  });

/** Transitions de statut : démarrer, terminer, valider, réouvrir, archiver. */
export const setVisitStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ companyId: z.string().uuid(), visitId: z.string().uuid(), status: VisitStatusSchema }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const prev = await loadVisitScoped(supabase, data.companyId, data.visitId);
    assertTransition(prev.status, data.status);

    const isAssignee = prev.assigned_to === userId;
    const managerOnly = ["validee", "archivee", "planifiee"].includes(data.status) || prev.status === "validee";
    if (managerOnly || !isAssignee) {
      await assertCanManage(supabase, data.companyId, userId);
    } else {
      await assertCanEditVisit(supabase, data.companyId, data.visitId, userId);
    }

    if (data.status === "terminee") {
      const percent = await refreshVisitCompletion(supabase, data.visitId);
      if (percent < 100) throw new Error("Des éléments obligatoires sont manquants : complétez la visite avant de la clôturer.");
    }

    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { status: data.status };
    if (data.status === "en_cours" && !prev.started_at) patch.started_at = now;
    if (data.status === "terminee") patch.completed_at = now;
    if (data.status === "validee") {
      patch.validated_at = now;
      patch.validated_by = userId;
      if (!prev.completed_at) patch.completed_at = now;
    }
    if (data.status === "en_cours" && prev.status === "validee") {
      patch.validated_at = null;
      patch.validated_by = null;
    }

    const { error } = await supabase.from("technical_visits").update(patch as never).eq("id", data.visitId).eq("company_id", data.companyId);
    if (error) throw new Error(error.message);

    const action =
      data.status === "terminee"
        ? "visite.completed"
        : data.status === "validee"
          ? "visite.validated"
          : data.status === "archivee"
            ? "visite.archived"
            : prev.status === "validee"
              ? "visite.reopened"
              : "visite.update";
    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "technical_visit",
      entityId: data.visitId,
      action,
      oldValues: { status: prev.status },
      newValues: { status: data.status },
    });
    return { ok: true, status: data.status };
  });

export const deleteTechnicalVisit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid(), visitId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCanManage(supabase, data.companyId, userId);
    const visit = await loadVisitScoped(supabase, data.companyId, data.visitId);
    if (visit.status === "validee") throw new Error("Une visite validée ne peut pas être supprimée : archivez-la.");

    const { data: photos } = await supabase.from("technical_visit_photos").select("storage_path").eq("visit_id", data.visitId);
    const { error } = await supabase.from("technical_visits").delete().eq("id", data.visitId).eq("company_id", data.companyId);
    if (error) throw new Error(error.message);
    const paths = (photos ?? []).map((p) => p.storage_path);
    if (paths.length) await supabase.storage.from(VISIT_BUCKET).remove(paths);

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "technical_visit",
      entityId: data.visitId,
      action: "visite.deleted",
      oldValues: { reference: visit.reference, status: visit.status },
    });
    return { ok: true };
  });

/** Techniciens de l'entreprise (sélecteur d'assignation). */
export const listVisitAssignees = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertIsMember(supabase, data.companyId, userId);
    const { data: members } = await supabase
      .from("company_members")
      .select("user_id,role")
      .eq("company_id", data.companyId)
      .eq("status", "active")
      .not("user_id", "is", null);
    const ids = (members ?? []).map((m) => m.user_id).filter(Boolean) as string[];
    if (ids.length === 0) return { assignees: [] };
    const { data: profiles } = await supabase.from("profiles").select("id,full_name").in("id", ids);
    const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name] as const));
    return {
      assignees: (members ?? [])
        .filter((m) => m.user_id)
        .map((m) => ({ id: m.user_id as string, name: nameById.get(m.user_id as string) ?? "Membre", role: m.role })),
    };
  });

/** Vérifie côté serveur qu'une adresse normalisée correspond (utilisé par les tests d'anti-doublon). */
export const previewChantierNameForVisit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid(), clientId: z.string().uuid(), visit_type: VisitTypeSchema }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertIsMember(supabase, data.companyId, userId);
    const { data: client } = await supabase
      .from("clients")
      .select("name,company_name,client_type,address_line1,postal_code,city")
      .eq("id", data.clientId)
      .eq("company_id", data.companyId)
      .maybeSingle();
    if (!client) throw new Error("Client introuvable.");
    const label = client.client_type === "professionnel" ? client.company_name || client.name : client.name;
    return {
      name: buildChantierName(data.visit_type, label ?? ""),
      addressKey: normalizeAddressKey(client),
      address_line1: client.address_line1 ?? "",
      postal_code: client.postal_code ?? "",
      city: client.city ?? "",
    };
  });

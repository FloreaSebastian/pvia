/**
 * Cahiers des charges — fonctions serveur.
 *
 * Règles structurantes :
 *  - un cahier des charges ne crée JAMAIS de chantier automatiquement ;
 *  - les notes internes ne sortent jamais vers le client (PDF, email, portail) ;
 *  - toute écriture exige un rôle de gestion ET une entreprise en droit d'écrire.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { writeAuditLog } from "./audit.server";
import {
  CreateStudySchema,
  StudyAnswerEntrySchema,
  StudyConversionSchema,
  StudyDecisionSchema,
  StudyDocumentSchema,
  StudyFiltersSchema,
  StudyNoteSchema,
  UpdateStudySchema,
  STUDY_ALLOWED_MIMES,
  STUDY_MAX_FILE_BYTES,
} from "./etudes/schemas";
import { getStudyTemplate } from "./etudes/templates";
import { computeStudyEstimate } from "./etudes/estimate";
import type { StudyType } from "./etudes/types";
import {
  assertCanEditStudy,
  assertStudyAdmin,
  assertStudyManage,
  assertStudyMember,
  assertStudyTransition,
  buildStudySnapshot,
  computeStudyProgress,
  isStudyLocked,
  loadStudyAnswers,
  loadStudyScoped,
  refreshStudyState,
  studyStoragePrefix,
  STUDY_BUCKET,
  STUDY_SIGNED_TTL,
} from "./etudes.server";

const CompanyStudy = z.object({ companyId: z.string().uuid(), studyId: z.string().uuid() });

/* --------------------------------- Lecture --------------------------------- */

export const listStudies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => StudyFiltersSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertStudyMember(supabase, data.companyId, userId);

    let q = supabase
      .from("technical_studies")
      .select(
        "id,reference,study_type,status,title,site_address,site_city,site_postal_code,completion_percent," +
          "estimate,assigned_to,created_at,updated_at,sent_at,decision,decision_at,converted_chantier_id,converted_visit_id," +
          "client:clients(id,name,company_name,client_type,email,phone)",
        { count: "exact" },
      )
      .eq("company_id", data.companyId);

    if (!data.include_archived) q = q.neq("status", "archived");
    if (data.study_type) q = q.eq("study_type", data.study_type);
    if (data.status) q = q.eq("status", data.status);
    if (data.client_id) q = q.eq("client_id", data.client_id);
    if (data.assigned_to) q = q.eq("assigned_to", data.assigned_to);

    const { data: rows, count, error } = await q
      .order("created_at", { ascending: false })
      .range(data.offset, data.offset + data.limit - 1);
    if (error) throw new Error(error.message);

    type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };
    type ListRow = Record<string, JsonValue> & {
      reference?: string;
      title?: string | null;
      site_address?: string | null;
      site_city?: string | null;
      client?: { name?: string; company_name?: string; email?: string; phone?: string } | null;
    };
    const list = (rows ?? []) as unknown as ListRow[];

    const search = data.search.trim().toLowerCase();
    const filtered = !search
      ? list
      : list.filter((r) =>
          [r.reference, r.title, r.site_address, r.site_city, r.client?.name, r.client?.company_name, r.client?.email, r.client?.phone]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(search)),
        );

    return { studies: JSON.parse(JSON.stringify(filtered)) as ListRow[], total: count ?? filtered.length };
  });

async function signDocuments(
  supabase: { storage: { from: (b: string) => { createSignedUrl: (p: string, t: number) => Promise<{ data: { signedUrl: string } | null }> } } },
  docs: { storage_path: string }[],
) {
  return Promise.all(
    docs.map(async (d) => {
      const { data } = await supabase.storage.from(STUDY_BUCKET).createSignedUrl(d.storage_path, STUDY_SIGNED_TTL);
      return { ...d, url: data?.signedUrl ?? null };
    }),
  );
}

export const getStudy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => CompanyStudy.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertStudyMember(supabase, data.companyId, userId);
    const study = await loadStudyScoped(supabase, data.companyId, data.studyId);

    const [clientRes, answersRes, docsRes, notesRes, versionsRes] = await Promise.all([
      supabase
        .from("clients")
        .select("id,name,company_name,client_type,email,phone,address,city,postal_code,siret")
        .eq("id", study.client_id)
        .maybeSingle(),
      supabase.from("technical_study_answers").select("section_key,field_key,value").eq("study_id", data.studyId),
      supabase
        .from("technical_study_documents")
        .select("id,kind,category,label,description,doc_date,storage_path,mime_type,size_bytes,created_at,uploaded_by")
        .eq("study_id", data.studyId)
        .order("created_at", { ascending: false }),
      supabase
        .from("technical_study_notes")
        .select("id,visibility,body,author_id,created_at")
        .eq("study_id", data.studyId)
        .order("created_at", { ascending: false }),
      supabase
        .from("technical_study_versions")
        .select("id,version,created_at,created_by")
        .eq("study_id", data.studyId)
        .order("version", { ascending: false }),
    ]);

    const answers: Record<string, string | number | boolean | string[] | null> = {};
    for (const a of (answersRes.data ?? []) as { field_key: string; value: string | number | boolean | string[] | null }[]) {
      answers[a.field_key] = a.value;
    }

    const type = study.study_type as StudyType;
    const photoSlots = new Set(
      ((docsRes.data ?? []) as { kind: string; label: string | null }[])
        .filter((d) => d.kind === "photo" && d.label)
        .map((d) => d.label as string),
    );
    const progress = computeStudyProgress(type, answers as never, photoSlots);
    const estimate = computeStudyEstimate(type, answers as never);

    return {
      study,
      client: clientRes.data ?? null,
      answers,
      documents: await signDocuments(supabase as never, (docsRes.data ?? []) as { storage_path: string }[]),
      notes: notesRes.data ?? [],
      versions: versionsRes.data ?? [],
      progress,
      estimate,
      locked: isStudyLocked(study.status),
    };
  });

/* -------------------------------- Création --------------------------------- */

export const createStudy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => CreateStudySchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertStudyManage(supabase, data.companyId, userId);

    const { data: client } = await supabase
      .from("clients")
      .select("id,name,company_name,address,city,postal_code,archived_at")
      .eq("id", data.client_id)
      .eq("company_id", data.companyId)
      .maybeSingle();
    if (!client) throw new Error("Client introuvable.");
    if ((client as { archived_at: string | null }).archived_at) throw new Error("Ce client est archivé.");

    const template = getStudyTemplate(data.study_type);
    const clientLabel = (client as { company_name: string | null; name: string }).company_name || (client as { name: string }).name;

    const { data: row, error } = await supabase
      .from("technical_studies")
      .insert({
        company_id: data.companyId,
        client_id: data.client_id,
        study_type: data.study_type,
        reference: "",
        title: data.title || `${template.label} — ${clientLabel}`,
        site_address: data.site_address || (client as { address: string | null }).address || null,
        site_postal_code: data.site_postal_code || (client as { postal_code: string | null }).postal_code || null,
        site_city: data.site_city || (client as { city: string | null }).city || null,
        assigned_to: data.assigned_to ?? userId,
        created_by: userId,
      } as never)
      .select("id,reference")
      .single();
    if (error || !row) throw new Error(error?.message ?? "Création impossible.");

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "technical_study",
      entityId: (row as { id: string }).id,
      action: "etude.created",
      newValues: { reference: (row as { reference: string }).reference, study_type: data.study_type },
    });

    return { id: (row as { id: string }).id, reference: (row as { reference: string }).reference };
  });

export const updateStudy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => UpdateStudySchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCanEditStudy(supabase, data.companyId, data.studyId, userId);

    const patch: Record<string, unknown> = {};
    for (const key of ["title", "site_address", "site_postal_code", "site_city", "summary"] as const) {
      if (data[key] !== undefined) patch[key] = data[key];
    }
    if (data.assigned_to !== undefined) patch.assigned_to = data.assigned_to;
    if (Object.keys(patch).length === 0) return { ok: true };

    const { error } = await supabase
      .from("technical_studies")
      .update(patch as never)
      .eq("id", data.studyId)
      .eq("company_id", data.companyId);
    if (error) throw new Error(error.message);

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "technical_study",
      entityId: data.studyId,
      action: "etude.updated",
      newValues: patch,
    });
    return { ok: true };
  });

/* --------------------------------- Réponses -------------------------------- */

export const saveStudyAnswers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        companyId: z.string().uuid(),
        studyId: z.string().uuid(),
        entries: z.array(StudyAnswerEntrySchema).min(1).max(200),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCanEditStudy(supabase, data.companyId, data.studyId, userId);

    const rows = data.entries.map((e) => ({
      study_id: data.studyId,
      company_id: data.companyId,
      section_key: e.section_key,
      field_key: e.field_key,
      value: e.value,
      updated_by: userId,
    }));
    const { error } = await supabase
      .from("technical_study_answers")
      .upsert(rows as never, { onConflict: "study_id,field_key" });
    if (error) throw new Error(error.message);

    const state = await refreshStudyState(supabase, data.studyId);
    return { ok: true, completion_percent: state.percent, estimate: state.estimate };
  });

/* -------------------------- Documents & photos ------------------------------ */

export const addStudyDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ companyId: z.string().uuid(), studyId: z.string().uuid(), document: StudyDocumentSchema }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCanEditStudy(supabase, data.companyId, data.studyId, userId);

    const doc = data.document;
    if (!doc.storage_path.startsWith(studyStoragePrefix(data.companyId, data.studyId))) {
      throw new Error("Chemin de stockage invalide.");
    }
    if (!(STUDY_ALLOWED_MIMES as readonly string[]).includes(doc.mime_type)) {
      throw new Error("Format non supporté (PDF, JPEG, PNG ou WebP).");
    }
    if (doc.size_bytes > STUDY_MAX_FILE_BYTES) throw new Error("Fichier trop volumineux (max 10 Mo).");

    const { data: row, error } = await supabase
      .from("technical_study_documents")
      .insert({
        study_id: data.studyId,
        company_id: data.companyId,
        kind: doc.kind,
        category: doc.category,
        label: doc.label || null,
        description: doc.description || null,
        doc_date: doc.doc_date ?? null,
        storage_path: doc.storage_path,
        mime_type: doc.mime_type,
        size_bytes: doc.size_bytes,
        uploaded_by: userId,
      } as never)
      .select("id,kind,category,label,description,doc_date,storage_path,mime_type,size_bytes,created_at")
      .single();
    if (error || !row) throw new Error(error?.message ?? "Enregistrement impossible.");

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "technical_study",
      entityId: data.studyId,
      action: "etude.document_added",
      metadata: { category: doc.category, kind: doc.kind },
    });

    const state = await refreshStudyState(supabase, data.studyId);
    const [signed] = await signDocuments(supabase as never, [row as { storage_path: string }]);
    return { ok: true, document: signed, completion_percent: state.percent };
  });

export const deleteStudyDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ companyId: z.string().uuid(), studyId: z.string().uuid(), documentId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCanEditStudy(supabase, data.companyId, data.studyId, userId);

    const { data: doc } = await supabase
      .from("technical_study_documents")
      .select("id,storage_path,category")
      .eq("id", data.documentId)
      .eq("study_id", data.studyId)
      .eq("company_id", data.companyId)
      .maybeSingle();
    if (!doc) throw new Error("Document introuvable.");

    const { error } = await supabase
      .from("technical_study_documents")
      .delete()
      .eq("id", data.documentId)
      .eq("company_id", data.companyId);
    if (error) throw new Error(error.message);
    await supabase.storage.from(STUDY_BUCKET).remove([(doc as { storage_path: string }).storage_path]);

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "technical_study",
      entityId: data.studyId,
      action: "etude.document_deleted",
      metadata: { category: (doc as { category: string }).category },
    });
    const state = await refreshStudyState(supabase, data.studyId);
    return { ok: true, completion_percent: state.percent };
  });

/* ----------------------------------- Notes ---------------------------------- */

export const addStudyNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => StudyNoteSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCanEditStudy(supabase, data.companyId, data.studyId, userId);

    const { data: row, error } = await supabase
      .from("technical_study_notes")
      .insert({
        study_id: data.studyId,
        company_id: data.companyId,
        visibility: data.visibility,
        body: data.body,
        author_id: userId,
      } as never)
      .select("id,visibility,body,author_id,created_at")
      .single();
    if (error || !row) throw new Error(error?.message ?? "Note non enregistrée.");

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "technical_study",
      entityId: data.studyId,
      action: "etude.note_added",
      metadata: { visibility: data.visibility },
    });
    return { ok: true, note: row };
  });

export const deleteStudyNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ companyId: z.string().uuid(), studyId: z.string().uuid(), noteId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertCanEditStudy(supabase, data.companyId, data.studyId, userId);
    const { error } = await supabase
      .from("technical_study_notes")
      .delete()
      .eq("id", data.noteId)
      .eq("study_id", data.studyId)
      .eq("company_id", data.companyId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ------------------------------ Cycle de vie -------------------------------- */

export const submitStudyForReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => CompanyStudy.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const study = await assertCanEditStudy(supabase, data.companyId, data.studyId, userId);
    assertStudyTransition(study.status, "internal_review");

    const state = await refreshStudyState(supabase, data.studyId);
    if (!state.progress.canComplete) {
      throw new Error(`Cahier des charges incomplet : ${state.progress.missingCount} élément(s) obligatoire(s) manquant(s).`);
    }

    const { error } = await supabase
      .from("technical_studies")
      .update({ status: "internal_review", submitted_at: new Date().toISOString(), review_comment: null } as never)
      .eq("id", data.studyId)
      .eq("company_id", data.companyId);
    if (error) throw new Error(error.message);

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "technical_study",
      entityId: data.studyId,
      action: "etude.submitted",
    });
    return { ok: true };
  });

export const reviewStudy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        companyId: z.string().uuid(),
        studyId: z.string().uuid(),
        decision: z.enum(["approve", "changes"]),
        comment: z.string().trim().max(2000).optional().default(""),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertStudyAdmin(supabase, data.companyId, userId);
    const study = await loadStudyScoped(supabase, data.companyId, data.studyId);
    if (study.status !== "internal_review") throw new Error("Ce cahier des charges n'est pas en attente de validation.");
    if (data.decision === "changes" && data.comment.trim().length < 5) {
      throw new Error("Merci d'indiquer ce qui doit être corrigé (5 caractères minimum).");
    }

    const next = data.decision === "approve" ? "completed" : "in_progress";
    const { error } = await supabase
      .from("technical_studies")
      .update({
        status: next,
        review_comment: data.decision === "changes" ? data.comment : null,
        validated_at: data.decision === "approve" ? new Date().toISOString() : null,
        validated_by: data.decision === "approve" ? userId : null,
      } as never)
      .eq("id", data.studyId)
      .eq("company_id", data.companyId)
      .eq("status", "internal_review");
    if (error) throw new Error(error.message);

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "technical_study",
      entityId: data.studyId,
      action: data.decision === "approve" ? "etude.validated" : "etude.changes_requested",
      metadata: { comment: data.comment || null },
    });
    return { ok: true, status: next };
  });

export const recordStudyDecision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => StudyDecisionSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertStudyManage(supabase, data.companyId, userId);
    const study = await loadStudyScoped(supabase, data.companyId, data.studyId);
    assertStudyTransition(study.status, data.decision === "accepted" ? "accepted" : "refused");

    const { error } = await supabase
      .from("technical_studies")
      .update({
        status: data.decision,
        decision: data.decision,
        decision_at: new Date().toISOString(),
        decision_reason: data.reason || null,
      } as never)
      .eq("id", data.studyId)
      .eq("company_id", data.companyId)
      .eq("status", study.status);
    if (error) throw new Error(error.message);

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "technical_study",
      entityId: data.studyId,
      action: data.decision === "accepted" ? "etude.accepted" : "etude.refused",
      metadata: { reason: data.reason || null },
    });
    return { ok: true };
  });

export const archiveStudy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => CompanyStudy.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertStudyManage(supabase, data.companyId, userId);
    const { error } = await supabase
      .from("technical_studies")
      .update({ status: "archived", archived_at: new Date().toISOString() } as never)
      .eq("id", data.studyId)
      .eq("company_id", data.companyId);
    if (error) throw new Error(error.message);
    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "technical_study",
      entityId: data.studyId,
      action: "etude.archived",
    });
    return { ok: true };
  });

export const deleteStudy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => CompanyStudy.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertStudyAdmin(supabase, data.companyId, userId);
    const study = await loadStudyScoped(supabase, data.companyId, data.studyId);
    if (study.sent_at) throw new Error("Un cahier des charges déjà envoyé au client ne peut pas être supprimé : archivez-le.");

    const { data: docs } = await supabase
      .from("technical_study_documents")
      .select("storage_path")
      .eq("study_id", data.studyId);
    const { error } = await supabase
      .from("technical_studies")
      .delete()
      .eq("id", data.studyId)
      .eq("company_id", data.companyId);
    if (error) throw new Error(error.message);
    const paths = ((docs ?? []) as { storage_path: string }[]).map((d) => d.storage_path);
    if (paths.length) await supabase.storage.from(STUDY_BUCKET).remove(paths);

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "technical_study",
      entityId: data.studyId,
      action: "etude.deleted",
      oldValues: { reference: study.reference, status: study.status },
    });
    return { ok: true };
  });

/* ---------------------------------- PDF ------------------------------------- */

export const generateStudyPdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => CompanyStudy.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertStudyManage(supabase, data.companyId, userId);
    await loadStudyScoped(supabase, data.companyId, data.studyId);

    const { buildAndStoreStudyPdf } = await import("./etudes-pdf.server");
    const path = await buildAndStoreStudyPdf(data.companyId, data.studyId);

    const { data: signed } = await supabase.storage.from(STUDY_BUCKET).createSignedUrl(path, STUDY_SIGNED_TTL);
    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "technical_study",
      entityId: data.studyId,
      action: "etude.pdf_generated",
    });
    return { ok: true, path, url: signed?.signedUrl ?? null };
  });

/* ------------------------------ Envoi au client ------------------------------ */

export const sendStudyToClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z
      .object({
        companyId: z.string().uuid(),
        studyId: z.string().uuid(),
        message: z.string().trim().max(3000).optional().default(""),
        email: z.string().trim().email("Adresse e-mail invalide.").optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertStudyManage(supabase, data.companyId, userId);
    const study = await loadStudyScoped(supabase, data.companyId, data.studyId);
    if (study.status !== "completed" && study.status !== "sent") {
      throw new Error("Le cahier des charges doit être validé en interne avant l'envoi au client.");
    }

    const { data: client } = await supabase
      .from("clients")
      .select("id,name,company_name,email")
      .eq("id", study.client_id)
      .eq("company_id", data.companyId)
      .maybeSingle();
    const to = (data.email || (client as { email: string | null } | null)?.email || "").trim();
    if (!to) throw new Error("Aucune adresse e-mail connue pour ce client.");

    const { buildAndStoreStudyPdf } = await import("./etudes-pdf.server");
    const pdfPath = await buildAndStoreStudyPdf(data.companyId, data.studyId);

    const snapshot = await buildStudySnapshot(supabase, data.studyId);
    const nextVersion = (study.version ?? 1) + (study.sent_at ? 1 : 0);
    await supabase.from("technical_study_versions").insert({
      company_id: data.companyId,
      study_id: data.studyId,
      version: nextVersion,
      snapshot: snapshot as never,
      pdf_path: pdfPath,
      created_by: userId,
    } as never);

    const { sendStudyEmail } = await import("./etudes-email.server");
    const result = await sendStudyEmail({
      companyId: data.companyId,
      studyId: data.studyId,
      to,
      message: data.message,
    });

    await supabase
      .from("technical_studies")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        sent_to_email: to,
        client_message: data.message || null,
        version: nextVersion,
        pdf_path: pdfPath,
        pdf_generated_at: new Date().toISOString(),
      } as never)
      .eq("id", data.studyId)
      .eq("company_id", data.companyId);

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "technical_study",
      entityId: data.studyId,
      action: result.status === "sent" ? "etude.sent_to_client" : "etude.send_failed",
      metadata: { recipient: to, version: nextVersion, email_status: result.status },
    });

    if (result.status !== "sent") {
      throw new Error("Le cahier des charges est figé mais l'e-mail n'a pas pu partir. Réessayez dans quelques minutes.");
    }
    return { ok: true, version: nextVersion };
  });

/* --------------------------- Conversion & duplication ------------------------ */

export const convertStudy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => StudyConversionSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertStudyManage(supabase, data.companyId, userId);
    const study = await loadStudyScoped(supabase, data.companyId, data.studyId);
    if (!data.create_chantier && !data.create_visit) throw new Error("Sélectionnez au moins une action.");
    if (data.create_visit && !data.create_chantier && !study.converted_chantier_id) {
      throw new Error("Une visite technique nécessite un chantier : créez-le d'abord.");
    }

    const template = getStudyTemplate(study.study_type as StudyType);
    let chantierId = study.converted_chantier_id;

    if (data.create_chantier && !chantierId) {
      const { data: chantier, error } = await supabase
        .from("chantiers")
        .insert({
          company_id: data.companyId,
          client_id: study.client_id,
          name: study.title ?? template.label,
          type: template.chantierType,
          address: study.site_address,
          address_line1: study.site_address,
          postal_code: study.site_postal_code,
          city: study.site_city,
          status: "prepare",
          created_by: userId,
        } as never)
        .select("id,reference")
        .single();
      if (error || !chantier) throw new Error(error?.message ?? "Création du chantier impossible.");
      chantierId = (chantier as { id: string }).id;
    }

    let visitId = study.converted_visit_id;
    if (data.create_visit && !visitId && chantierId) {
      const answers = await loadStudyAnswers(supabase, data.studyId);
      const prep = [
        `Issu du cahier des charges ${study.reference}.`,
        answers["contraintes_identifiees"] ? `Contraintes : ${String(answers["contraintes_identifiees"])}` : null,
        answers["questions_ouvertes"] ? `Questions ouvertes : ${String(answers["questions_ouvertes"])}` : null,
      ]
        .filter(Boolean)
        .join("\n");

      const { data: visit, error } = await supabase
        .from("technical_visits")
        .insert({
          company_id: data.companyId,
          client_id: study.client_id,
          chantier_id: chantierId,
          visit_type: study.study_type,
          reference: "",
          status: "a_planifier",
          site_address: study.site_address,
          assigned_to: study.assigned_to,
          prep_notes: prep.slice(0, 5000),
          created_by: userId,
        } as never)
        .select("id")
        .maybeSingle();
      if (error) throw new Error(error.message);
      visitId = (visit as { id: string } | null)?.id ?? null;
    }

    await supabase
      .from("technical_studies")
      .update({
        converted_chantier_id: chantierId,
        converted_visit_id: visitId,
        converted_at: new Date().toISOString(),
      } as never)
      .eq("id", data.studyId)
      .eq("company_id", data.companyId);

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "technical_study",
      entityId: data.studyId,
      action: "etude.converted",
      metadata: { chantier_id: chantierId, visit_id: visitId },
    });
    return { ok: true, chantierId, visitId };
  });

export const duplicateStudy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => CompanyStudy.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertStudyManage(supabase, data.companyId, userId);
    const study = await loadStudyScoped(supabase, data.companyId, data.studyId);

    const { data: copy, error } = await supabase
      .from("technical_studies")
      .insert({
        company_id: data.companyId,
        client_id: study.client_id,
        study_type: study.study_type,
        reference: "",
        title: `${study.title ?? "Cahier des charges"} (copie)`,
        site_address: study.site_address,
        site_postal_code: study.site_postal_code,
        site_city: study.site_city,
        assigned_to: study.assigned_to ?? userId,
        duplicated_from: study.id,
        created_by: userId,
      } as never)
      .select("id,reference")
      .single();
    if (error || !copy) throw new Error(error?.message ?? "Duplication impossible.");

    const { data: answers } = await supabase
      .from("technical_study_answers")
      .select("section_key,field_key,value")
      .eq("study_id", data.studyId);
    if (answers?.length) {
      await supabase.from("technical_study_answers").insert(
        (answers as { section_key: string; field_key: string; value: unknown }[]).map((a) => ({
          study_id: (copy as { id: string }).id,
          company_id: data.companyId,
          section_key: a.section_key,
          field_key: a.field_key,
          value: a.value,
          updated_by: userId,
        })) as never,
      );
    }
    await refreshStudyState(supabase, (copy as { id: string }).id);

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "technical_study",
      entityId: (copy as { id: string }).id,
      action: "etude.duplicated",
      metadata: { source: study.reference },
    });
    return { id: (copy as { id: string }).id, reference: (copy as { reference: string }).reference };
  });

/* --------------------------------- Historique -------------------------------- */

export const getStudyHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => CompanyStudy.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertStudyMember(supabase, data.companyId, userId);
    await loadStudyScoped(supabase, data.companyId, data.studyId);

    const { data: logs } = await supabase
      .from("audit_logs")
      .select("id,action,created_at,user_id,metadata")
      .eq("company_id", data.companyId)
      .eq("entity_type", "technical_study")
      .eq("entity_id", data.studyId)
      .order("created_at", { ascending: false })
      .limit(100);
    return { events: logs ?? [] };
  });

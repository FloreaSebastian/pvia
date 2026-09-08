/**
 * Dossier administratif & conformité des sous-traitants.
 *
 * Règles non négociables :
 *  - Le tenant (`company_id`) est TOUJOURS revérifié côté serveur ; aucun
 *    identifiant fourni par le navigateur n'est accepté tel quel.
 *  - Lecture : membres internes de l'entreprise donneuse d'ordre.
 *  - Écriture (dépôt, remplacement, archivage, métadonnées, règles) :
 *    administrateurs d'entreprise uniquement.
 *  - Aucun accès sous-traitant / client en V1.
 *  - Stockage privé, chemin tenant-scopé non devinable, lien signé très court.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { writeAuditLog } from "./audit.server";
import { SIGNED_URL_ADMIN_DOC_TTL } from "./signed-url-ttl";
import { decodeBase64, extensionForMime, sniffDocumentMime } from "./file-sniff";
import {
  computeCompliance,
  docTypeLabel,
  formatFrDate,
  SUBCONTRACTOR_DOC_TYPES,
  type ComplianceSummary,
} from "./subcontractor-compliance";

const BUCKET = "pv-assets";
const MAX_BYTES = 10 * 1024 * 1024;

const DocTypeSchema = z.enum(SUBCONTRACTOR_DOC_TYPES);

async function assertMember(sb: SupabaseClient<Database>, companyId: string, userId: string) {
  const { data, error } = await sb.rpc("is_company_member", { _company_id: companyId, _user_id: userId });
  if (error) throw new Error("Vérification des droits impossible.");
  if (data !== true) throw new Error("Droits insuffisants.");
}

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

/** Le partenaire appartient-il réellement au tenant ? (anti-IDOR) */
async function requirePartner(
  sb: SupabaseClient<Database>,
  companyId: string,
  subcontractorCompanyId: string,
): Promise<{ id: string; name: string }> {
  const { data } = await sb
    .from("subcontractor_companies")
    .select("id,name")
    .eq("id", subcontractorCompanyId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!data) throw new Error("Sous-traitant introuvable.");
  return data as { id: string; name: string };
}

async function actorLabel(sb: SupabaseClient<Database>, userId: string): Promise<string> {
  const { data } = await sb.from("profiles").select("full_name,email").eq("id", userId).maybeSingle();
  const p = data as { full_name?: string | null; email?: string | null } | null;
  return p?.full_name || p?.email || "Un administrateur";
}

// ------------------------------------------------------------------ lectures

export const listSubcontractorDocuments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ companyId: z.string().uuid(), subcontractorCompanyId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, data.companyId, userId);
    const partner = await requirePartner(supabase, data.companyId, data.subcontractorCompanyId);

    const [docsRes, rulesRes] = await Promise.all([
      supabase
        .from("subcontractor_documents")
        .select(
          "id,doc_type,label,original_filename,mime_type,size_bytes,issue_date,expiry_date,is_required,is_blocking,notes,uploaded_by,uploaded_at,archived_at,replaced_by_id,created_at,review_status,reviewed_by,reviewed_at,rejection_reason,submitted_by_subcontractor_user_id",
        )
        .eq("company_id", data.companyId)
        .eq("subcontractor_company_id", data.subcontractorCompanyId)
        .order("uploaded_at", { ascending: false }),
      supabase
        .from("subcontractor_document_rules")
        .select("doc_type,is_required,is_blocking")
        .eq("company_id", data.companyId)
        .eq("subcontractor_company_id", data.subcontractorCompanyId),
    ]);

    const documents = (docsRes.data ?? []) as any[];
    const rules = (rulesRes.data ?? []) as any[];
    const summary = computeCompliance(documents as any, rules as any);

    return { partner, documents, rules, summary };
  });

/** Conformité de TOUS les partenaires du tenant (badges de la liste). */
export const listSubcontractorsCompliance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, data.companyId, userId);

    const [docsRes, rulesRes] = await Promise.all([
      supabase
        .from("subcontractor_documents")
        .select("id,subcontractor_company_id,doc_type,label,expiry_date,issue_date,is_required,is_blocking,archived_at,review_status,rejection_reason")
        .eq("company_id", data.companyId),
      supabase
        .from("subcontractor_document_rules")
        .select("subcontractor_company_id,doc_type,is_required,is_blocking")
        .eq("company_id", data.companyId),
    ]);

    const byPartner: Record<string, ComplianceSummary> = {};
    const ids = new Set<string>([
      ...((docsRes.data ?? []) as any[]).map((d) => d.subcontractor_company_id as string),
      ...((rulesRes.data ?? []) as any[]).map((r) => r.subcontractor_company_id as string),
    ]);
    for (const id of ids) {
      byPartner[id] = computeCompliance(
        ((docsRes.data ?? []) as any[]).filter((d) => d.subcontractor_company_id === id) as any,
        ((rulesRes.data ?? []) as any[]).filter((r) => r.subcontractor_company_id === id) as any,
      );
    }
    return { byPartner };
  });

/** Lien signé court pour consulter une pièce. Journalisé. */
export const getSubcontractorDocumentUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ companyId: z.string().uuid(), documentId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, data.companyId, userId);

    // La ligne n'est visible que si elle appartient au tenant (RLS + filtre explicite).
    const { data: doc } = await supabase
      .from("subcontractor_documents")
      .select("id,storage_path,original_filename,doc_type,label,subcontractor_company_id")
      .eq("id", data.documentId)
      .eq("company_id", data.companyId)
      .maybeSingle();
    if (!doc) throw new Error("Document introuvable.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrl((doc as any).storage_path, SIGNED_URL_ADMIN_DOC_TTL);
    if (error || !signed?.signedUrl) throw new Error("Lien indisponible, réessayez.");

    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "subcontractor_document",
      entityId: doc.id as string,
      action: "subcontractor_document.viewed",
      metadata: {
        doc_type: (doc as any).doc_type,
        subcontractor_company_id: (doc as any).subcontractor_company_id,
      },
    });

    return { url: signed.signedUrl, filename: (doc as any).original_filename as string, expiresIn: SIGNED_URL_ADMIN_DOC_TTL };
  });

// ------------------------------------------------------------------ écritures

const UploadSchema = z.object({
  companyId: z.string().uuid(),
  subcontractorCompanyId: z.string().uuid(),
  docType: DocTypeSchema,
  label: z.string().trim().max(160).optional().default(""),
  filename: z.string().trim().min(1).max(200),
  fileBase64: z.string().min(16),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  isRequired: z.boolean().optional().default(true),
  isBlocking: z.boolean().optional().default(false),
  notes: z.string().trim().max(2000).optional().default(""),
  /** Remplacement : l'ancienne pièce est archivée, jamais détruite. */
  replaceDocumentId: z.string().uuid().optional(),
});

export const uploadSubcontractorDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => UploadSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdminWrite(supabase, data.companyId, userId);
    const partner = await requirePartner(supabase, data.companyId, data.subcontractorCompanyId);

    const bytes = decodeBase64(data.fileBase64, MAX_BYTES);
    const mime = sniffDocumentMime(bytes);
    if (!mime) throw new Error("Format non accepté. Déposez un PDF, un JPG ou un PNG valide.");
    const ext = extensionForMime(mime);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const path = `${data.companyId}/subcontractor-docs/${data.subcontractorCompanyId}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: mime, upsert: false });
    if (upErr) throw new Error("Envoi du fichier impossible, réessayez.");

    const { data: row, error } = await supabase
      .from("subcontractor_documents")
      .insert({
        company_id: data.companyId,
        subcontractor_company_id: data.subcontractorCompanyId,
        doc_type: data.docType,
        label: data.label || null,
        storage_path: path,
        original_filename: data.filename,
        mime_type: mime,
        size_bytes: bytes.length,
        issue_date: data.issueDate || null,
        expiry_date: data.expiryDate || null,
        is_required: data.isRequired,
        is_blocking: data.isBlocking,
        notes: data.notes || null,
        uploaded_by: userId,
      })
      .select("id")
      .single();
    if (error || !row) {
      await supabaseAdmin.storage.from(BUCKET).remove([path]).catch(() => {});
      throw new Error("Enregistrement impossible.");
    }

    let replaced: string | null = null;
    if (data.replaceDocumentId) {
      const { data: old } = await supabase
        .from("subcontractor_documents")
        .update({ archived_at: new Date().toISOString(), archived_by: userId, replaced_by_id: row.id })
        .eq("id", data.replaceDocumentId)
        .eq("company_id", data.companyId)
        .eq("subcontractor_company_id", data.subcontractorCompanyId)
        .is("archived_at", null)
        .select("id")
        .maybeSingle();
      replaced = (old?.id as string) ?? null;
    }

    const who = await actorLabel(supabase, userId);
    const label = docTypeLabel(data.docType, data.label);
    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "subcontractor_document",
      entityId: row.id as string,
      action: replaced ? "subcontractor_document.replaced" : "subcontractor_document.added",
      metadata: {
        summary: `${who} a ${replaced ? "remplacé" : "ajouté"} ${label} de ${partner.name}${
          data.expiryDate ? `, valable jusqu'au ${formatFrDate(data.expiryDate)}` : ""
        }.`,
        doc_type: data.docType,
        subcontractor_company_id: data.subcontractorCompanyId,
        expiry_date: data.expiryDate || null,
        replaced_document_id: replaced,
        size_bytes: bytes.length,
        mime_type: mime,
      },
    });

    return { ok: true, id: row.id as string, replacedId: replaced };
  });

const MetaSchema = z.object({
  companyId: z.string().uuid(),
  documentId: z.string().uuid(),
  label: z.string().trim().max(160).optional(),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  isRequired: z.boolean().optional(),
  isBlocking: z.boolean().optional(),
  notes: z.string().trim().max(2000).optional(),
});

export const updateSubcontractorDocumentMeta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => MetaSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdminWrite(supabase, data.companyId, userId);

    const patch: Record<string, unknown> = {};
    if (data.label !== undefined) patch.label = data.label || null;
    if (data.issueDate !== undefined) patch.issue_date = data.issueDate || null;
    if (data.expiryDate !== undefined) patch.expiry_date = data.expiryDate || null;
    if (data.isRequired !== undefined) patch.is_required = data.isRequired;
    if (data.isBlocking !== undefined) patch.is_blocking = data.isBlocking;
    if (data.notes !== undefined) patch.notes = data.notes || null;

    const { data: row, error } = await supabase
      .from("subcontractor_documents")
      .update(patch as never)
      .eq("id", data.documentId)
      .eq("company_id", data.companyId)
      .select("id,doc_type,label,expiry_date,subcontractor_company_id")
      .maybeSingle();
    if (error || !row) throw new Error("Modification impossible.");

    const who = await actorLabel(supabase, userId);
    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "subcontractor_document",
      entityId: data.documentId,
      action: "subcontractor_document.meta_updated",
      newValues: patch,
      metadata: {
        summary: `${who} a modifié les informations de ${docTypeLabel(
          (row as any).doc_type,
          (row as any).label,
        )}.`,
        subcontractor_company_id: (row as any).subcontractor_company_id,
      },
    });
    return { ok: true };
  });

export const archiveSubcontractorDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ companyId: z.string().uuid(), documentId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdminWrite(supabase, data.companyId, userId);

    const { data: row, error } = await supabase
      .from("subcontractor_documents")
      .update({ archived_at: new Date().toISOString(), archived_by: userId })
      .eq("id", data.documentId)
      .eq("company_id", data.companyId)
      .is("archived_at", null)
      .select("id,doc_type,label,subcontractor_company_id")
      .maybeSingle();
    if (error || !row) throw new Error("Archivage impossible.");

    const who = await actorLabel(supabase, userId);
    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "subcontractor_document",
      entityId: data.documentId,
      action: "subcontractor_document.archived",
      metadata: {
        summary: `${who} a archivé ${docTypeLabel((row as any).doc_type, (row as any).label)}.`,
        subcontractor_company_id: (row as any).subcontractor_company_id,
      },
    });
    return { ok: true };
  });

const RuleSchema = z.object({
  companyId: z.string().uuid(),
  subcontractorCompanyId: z.string().uuid(),
  docType: DocTypeSchema,
  isRequired: z.boolean(),
  isBlocking: z.boolean(),
});

export const saveSubcontractorDocumentRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => RuleSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdminWrite(supabase, data.companyId, userId);
    const partner = await requirePartner(supabase, data.companyId, data.subcontractorCompanyId);

    const { error } = await supabase
      .from("subcontractor_document_rules")
      .upsert(
        {
          company_id: data.companyId,
          subcontractor_company_id: data.subcontractorCompanyId,
          doc_type: data.docType,
          is_required: data.isRequired,
          is_blocking: data.isRequired ? data.isBlocking : false,
          updated_by: userId,
        },
        { onConflict: "subcontractor_company_id,doc_type" },
      );
    if (error) throw new Error("Enregistrement de la règle impossible.");

    const who = await actorLabel(supabase, userId);
    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "subcontractor_document_rule",
      entityId: data.subcontractorCompanyId,
      action: "subcontractor_document_rule.updated",
      metadata: {
        summary: `${who} a modifié la règle « ${docTypeLabel(data.docType)} » de ${partner.name} : ${
          data.isRequired ? "requise" : "non requise"
        }${data.isRequired && data.isBlocking ? " et bloquante" : ""}.`,
        doc_type: data.docType,
        is_required: data.isRequired,
        is_blocking: data.isRequired ? data.isBlocking : false,
      },
    });
    return { ok: true };
  });

/**
 * Recalcule côté serveur la conformité d'un partenaire — utilisé avant
 * affectation à un chantier (l'UI ne décide jamais seule).
 */
export const evaluateSubcontractorCompliance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ companyId: z.string().uuid(), subcontractorCompanyId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, data.companyId, userId);
    await requirePartner(supabase, data.companyId, data.subcontractorCompanyId);
    const { computeComplianceForPartner } = await import("./subcontractor-compliance.server");
    return computeComplianceForPartner(data.companyId, data.subcontractorCompanyId);
  });

// ------------------------------------------------- workflow de validation

/**
 * Validation / refus d'une pièce déposée par un sous-traitant.
 *
 * Seuls les administrateurs internes canoniques (`is_company_admin`) décident.
 * Le tenant, le partenaire ET la version exacte du document sont revalidés au
 * moment de l'action ; aucun identifiant navigateur n'est accepté tel quel.
 */
const ReviewSchema = z.object({
  companyId: z.string().uuid(),
  documentId: z.string().uuid(),
  decision: z.enum(["approve", "reject"]),
  reason: z.string().trim().max(1000).optional().default(""),
  internalNote: z.string().trim().max(2000).optional().default(""),
});

export const reviewSubcontractorDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => ReviewSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdminWrite(supabase, data.companyId, userId);

    if (data.decision === "reject" && data.reason.trim().length < 5) {
      throw new Error("Un motif de refus d'au moins 5 caractères est obligatoire.");
    }

    const { data: doc } = await supabase
      .from("subcontractor_documents")
      .select("id,doc_type,label,review_status,subcontractor_company_id,archived_at,expiry_date")
      .eq("id", data.documentId)
      .eq("company_id", data.companyId)
      .maybeSingle();
    if (!doc) throw new Error("Document introuvable.");
    if ((doc as any).archived_at) throw new Error("Cette version est archivée : elle ne peut plus être revue.");

    const partner = await requirePartner(supabase, data.companyId, (doc as any).subcontractor_company_id);
    const approved = data.decision === "approve";

    const { data: updated, error } = await supabase
      .from("subcontractor_documents")
      .update({
        review_status: approved ? "approved" : "rejected",
        reviewed_by: userId,
        reviewed_at: new Date().toISOString(),
        rejection_reason: approved ? null : data.reason.trim(),
        review_note: data.internalNote ? data.internalNote : null,
      } as never)
      .eq("id", data.documentId)
      .eq("company_id", data.companyId)
      .is("archived_at", null)
      .select("id")
      .maybeSingle();
    if (error || !updated) throw new Error("Décision impossible, réessayez.");

    const who = await actorLabel(supabase, userId);
    const label = docTypeLabel((doc as any).doc_type, (doc as any).label);
    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "subcontractor_document",
      entityId: data.documentId,
      action: approved ? "subcontractor_document.approved" : "subcontractor_document.rejected",
      metadata: {
        summary: `${who} a ${approved ? "validé" : "refusé"} ${label} de ${partner.name}${
          approved ? "" : ` — motif : ${data.reason.trim()}`
        }.`,
        doc_type: (doc as any).doc_type,
        subcontractor_company_id: partner.id,
        document_id: data.documentId,
        decision: approved ? "approved" : "rejected",
        rejection_reason: approved ? null : data.reason.trim(),
        previous_review_status: (doc as any).review_status,
        reviewed_at: new Date().toISOString(),
      },
    });

    const { notifySubcontractorUsers } = await import("./subcontractor-notify.server");
    await notifySubcontractorUsers(data.companyId, partner.id, {
      type: approved ? "subcontractor_document_approved" : "subcontractor_document_rejected",
      title: approved ? `Pièce validée — ${label}` : `Pièce refusée — ${label}`,
      body: approved
        ? `${label} a été validée par l'entreprise donneuse d'ordre.`
        : `${label} a été refusée. Motif : ${data.reason.trim()}. Déposez une nouvelle version depuis « Mes documents ».`,
      url: "/sous-traitant/documents",
      tag: `sc-doc-review-${data.documentId}`,
    });

    return { ok: true, reviewStatus: approved ? "approved" : "rejected" };
  });

/** File « À valider » du Centre de conformité (pièces déposées par les partenaires). */
export const listPendingSubcontractorDocuments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, data.companyId, userId);

    const { data: rows } = await supabase
      .from("subcontractor_documents")
      .select(
        "id,subcontractor_company_id,doc_type,label,original_filename,issue_date,expiry_date,is_required,is_blocking,uploaded_at,submitted_by_subcontractor_user_id",
      )
      .eq("company_id", data.companyId)
      .eq("review_status", "pending_review")
      .is("archived_at", null)
      .order("uploaded_at", { ascending: true })
      .limit(200);

    const docs = (rows ?? []) as any[];
    const partnerIds = [...new Set(docs.map((d) => d.subcontractor_company_id as string))];
    const submitterIds = [...new Set(docs.map((d) => d.submitted_by_subcontractor_user_id).filter(Boolean))];

    // Deux requêtes batchées : jamais de N+1 par ligne.
    const [{ data: partners }, submitters] = await Promise.all([
      partnerIds.length
        ? supabase.from("subcontractor_companies").select("id,name").in("id", partnerIds)
        : Promise.resolve({ data: [] as any[] }),
      submitterIds.length
        ? (async () => {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            const { data: su } = await supabaseAdmin
              .from("subcontractor_users")
              .select("id,full_name,email")
              .in("id", submitterIds as string[]);
            return (su ?? []) as any[];
          })()
        : Promise.resolve([] as any[]),
    ]);

    const partnerName = new Map(((partners ?? []) as any[]).map((p) => [p.id, p.name as string]));
    const submitter = new Map(
      submitters.map((s) => [s.id as string, (s.full_name || s.email || "Sous-traitant") as string]),
    );

    return {
      documents: docs.map((d) => ({
        id: d.id as string,
        subcontractorCompanyId: d.subcontractor_company_id as string,
        partnerName: partnerName.get(d.subcontractor_company_id) ?? "Partenaire",
        docType: d.doc_type as string,
        label: docTypeLabel(d.doc_type, d.label),
        filename: d.original_filename as string,
        issueDate: (d.issue_date as string) ?? null,
        expiryDate: (d.expiry_date as string) ?? null,
        isRequired: !!d.is_required,
        isBlocking: !!d.is_blocking,
        uploadedAt: d.uploaded_at as string,
        submittedBy: d.submitted_by_subcontractor_user_id
          ? (submitter.get(d.submitted_by_subcontractor_user_id) ?? "Sous-traitant")
          : "Entreprise",
      })),
    };
  });

/**
 * Centre de conformité : agrégation de TOUS les partenaires du tenant.
 * Trois requêtes batchées, aucune URL signée, aucun fichier chargé.
 */
export const getComplianceCenter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertMember(supabase, data.companyId, userId);

    const [partnersRes, docsRes, rulesRes] = await Promise.all([
      supabase
        .from("subcontractor_companies")
        .select("id,name,status,trades,siret,contact_email,archived_at")
        .eq("company_id", data.companyId),
      supabase
        .from("subcontractor_documents")
        .select(
          "id,subcontractor_company_id,doc_type,label,expiry_date,issue_date,is_required,is_blocking,archived_at,review_status,rejection_reason",
        )
        .eq("company_id", data.companyId),
      supabase
        .from("subcontractor_document_rules")
        .select("subcontractor_company_id,doc_type,is_required,is_blocking")
        .eq("company_id", data.companyId),
    ]);

    const docs = (docsRes.data ?? []) as any[];
    const rules = (rulesRes.data ?? []) as any[];
    const docsBy = new Map<string, any[]>();
    for (const d of docs) {
      const arr = docsBy.get(d.subcontractor_company_id) ?? [];
      arr.push(d);
      docsBy.set(d.subcontractor_company_id, arr);
    }
    const rulesBy = new Map<string, any[]>();
    for (const r of rules) {
      const arr = rulesBy.get(r.subcontractor_company_id) ?? [];
      arr.push(r);
      rulesBy.set(r.subcontractor_company_id, arr);
    }

    const partners = ((partnersRes.data ?? []) as any[]).map((p) => {
      const summary = computeCompliance(docsBy.get(p.id) ?? [], rulesBy.get(p.id) ?? []);
      return {
        id: p.id as string,
        name: p.name as string,
        status: p.status as string,
        archived: !!p.archived_at,
        trades: (p.trades ?? []) as string[],
        siret: (p.siret as string) ?? null,
        email: (p.contact_email as string) ?? null,
        summary,
      };
    });

    const activePartners = partners.filter((p) => !p.archived && p.status === "active");
    const expiringWithin = (n: number) =>
      activePartners.reduce(
        (acc, p) =>
          acc +
          p.summary.lines.filter(
            (l) => l.daysToExpiry !== null && l.daysToExpiry >= 0 && l.daysToExpiry <= n,
          ).length,
        0,
      );

    const kpis = {
      activePartners: activePartners.length,
      compliant: activePartners.filter((p) => p.summary.status === "compliant").length,
      blocked: activePartners.filter((p) => p.summary.status === "blocking").length,
      pendingReview: activePartners.reduce((a, p) => a + p.summary.counts.pendingReview, 0),
      expiring7: expiringWithin(7),
      expiring30: expiringWithin(30),
      expiring60: expiringWithin(60),
      expired: activePartners.reduce((a, p) => a + p.summary.counts.expired, 0),
      suspended: partners.filter((p) => p.archived || p.status !== "active").length,
    };

    return { partners, kpis };
  });

/**
 * Relance manuelle d'un partenaire (pièce manquante / expirée / refusée /
 * en attente). Anti-spam : une relance identique au plus toutes les 6 heures.
 */
const RemindSchema = z.object({
  companyId: z.string().uuid(),
  subcontractorCompanyId: z.string().uuid(),
  docType: DocTypeSchema.optional(),
  reason: z.enum(["missing", "expired", "expiring_soon", "rejected", "pending_review", "general"]),
});

export const REMINDER_COOLDOWN_HOURS = 6;

export const remindSubcontractorPartner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => RemindSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdminWrite(supabase, data.companyId, userId);
    const partner = await requirePartner(supabase, data.companyId, data.subcontractorCompanyId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = new Date(Date.now() - REMINDER_COOLDOWN_HOURS * 3600_000).toISOString();
    const { data: recent } = await supabaseAdmin
      .from("subcontractor_document_reminders")
      .select("id,created_at")
      .eq("company_id", data.companyId)
      .eq("subcontractor_company_id", data.subcontractorCompanyId)
      .eq("reason", data.reason)
      .gte("created_at", since)
      .limit(1);
    const already = ((recent ?? []) as any[]).find(
      (r) => true,
    );
    if (already) {
      return { ok: true, skipped: true as const, recipients: 0 };
    }

    const label = data.docType ? docTypeLabel(data.docType) : "vos pièces administratives";
    const reasonText: Record<string, string> = {
      missing: "est manquante",
      expired: "est expirée",
      expiring_soon: "arrive à échéance",
      rejected: "a été refusée",
      pending_review: "est en attente de votre dépôt complet",
      general: "doivent être mises à jour",
    };
    const { notifySubcontractorUsers } = await import("./subcontractor-notify.server");
    const companyName = await (async () => {
      const { data: c } = await supabase.from("companies").select("name").eq("id", data.companyId).maybeSingle();
      return ((c as any)?.name as string) ?? "L'entreprise donneuse d'ordre";
    })();

    const res = await notifySubcontractorUsers(data.companyId, partner.id, {
      type: "subcontractor_document_reminder",
      title: `${companyName} — pièce à mettre à jour`,
      body: `${label} ${reasonText[data.reason]}. Ouvrez « Mes documents » pour déposer la version à jour.`,
      url: "/sous-traitant/documents",
      tag: `sc-doc-remind-${partner.id}-${data.reason}`,
    });

    await supabaseAdmin.from("subcontractor_document_reminders").insert({
      company_id: data.companyId,
      subcontractor_company_id: partner.id,
      doc_type: data.docType ?? null,
      reason: data.reason,
      recipients: res.recipients,
      sent_by: userId,
    });

    const who = await actorLabel(supabase, userId);
    await writeAuditLog({
      companyId: data.companyId,
      userId,
      entityType: "subcontractor_company",
      entityId: partner.id,
      action: "subcontractor_document.reminder_sent",
      metadata: {
        summary: `${who} a relancé ${partner.name} (${label}).`,
        doc_type: data.docType ?? null,
        reason: data.reason,
        recipients: res.recipients,
      },
    });

    return { ok: true, skipped: false as const, recipients: res.recipients };
  });

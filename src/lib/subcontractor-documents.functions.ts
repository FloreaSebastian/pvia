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

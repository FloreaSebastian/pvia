/**
 * Portail de conformité — côté SOUS-TRAITANT connecté (« Mes documents »).
 *
 * Sécurité :
 *  - le tenant et le partenaire ne viennent JAMAIS du navigateur : ils sont
 *    dérivés de l'identité serveur via `requireMembership` (relation active,
 *    non révoquée, partenaire actif) ;
 *  - un sous-traitant ne voit que SES pièces, pour l'entreprise sélectionnée,
 *    et jamais les notes internes ni les autres partenaires ;
 *  - dépôt : PDF/JPG/PNG réellement sniffés, 10 Mo max, Storage privé,
 *    chemin non devinable, lien signé très court ;
 *  - tout dépôt sous-traitant part en « à vérifier » : il ne peut pas
 *    s'auto-valider ;
 *  - remplacement = archivage de la version précédente, jamais de destruction.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { writeAuditLog } from "./audit.server";
import { SIGNED_URL_ADMIN_DOC_TTL } from "./signed-url-ttl";
import { decodeBase64, extensionForMime, sniffDocumentMime } from "./file-sniff";
import {
  computeCompliance,
  docTypeLabel,
  SUBCONTRACTOR_DOC_TYPES,
} from "./subcontractor-compliance";
import {
  actorLabel,
  listActiveMemberships,
  requireMembership,
} from "./subcontractor-guard.server";

const BUCKET = "pv-assets";
const MAX_BYTES = 10 * 1024 * 1024;
const DocTypeSchema = z.enum(SUBCONTRACTOR_DOC_TYPES);

/** Entreprises donneuses d'ordre auxquelles le compte est réellement rattaché. */
export const listMyCompanies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const memberships = await listActiveMemberships(context.userId);
    return {
      companies: memberships.map((m) => ({
        companyId: m.companyId,
        companyName: m.companyName,
        subcontractorCompanyName: m.subcontractorCompanyName,
      })),
    };
  });

/** Dossier administratif du sous-traitant pour UNE entreprise donneuse d'ordre. */
export const listMyDocuments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ companyId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const m = await requireMembership(context.userId, data.companyId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [docsRes, rulesRes] = await Promise.all([
      supabaseAdmin
        .from("subcontractor_documents")
        .select(
          "id,doc_type,label,original_filename,mime_type,size_bytes,issue_date,expiry_date,is_required,is_blocking,uploaded_at,archived_at,replaced_by_id,review_status,rejection_reason,reviewed_at",
        )
        .eq("company_id", m.companyId)
        .eq("subcontractor_company_id", m.subcontractorCompanyId)
        .order("uploaded_at", { ascending: false }),
      supabaseAdmin
        .from("subcontractor_document_rules")
        .select("doc_type,is_required,is_blocking")
        .eq("company_id", m.companyId)
        .eq("subcontractor_company_id", m.subcontractorCompanyId),
    ]);

    const docs = (docsRes.data ?? []) as any[];
    const rules = (rulesRes.data ?? []) as any[];
    const summary = computeCompliance(docs as any, rules as any);

    return {
      company: { id: m.companyId, name: m.companyName },
      partnerName: m.subcontractorCompanyName,
      summary,
      // Notes internes de l'entreprise volontairement absentes du portail.
      documents: docs.map((d) => ({
        id: d.id as string,
        docType: d.doc_type as string,
        label: docTypeLabel(d.doc_type, d.label),
        filename: d.original_filename as string,
        sizeBytes: d.size_bytes as number,
        issueDate: (d.issue_date as string) ?? null,
        expiryDate: (d.expiry_date as string) ?? null,
        uploadedAt: d.uploaded_at as string,
        archived: !!d.archived_at,
        reviewStatus: (d.review_status as string) ?? "approved",
        rejectionReason: (d.rejection_reason as string) ?? null,
        reviewedAt: (d.reviewed_at as string) ?? null,
      })),
    };
  });

const MyUploadSchema = z.object({
  companyId: z.string().uuid(),
  docType: DocTypeSchema,
  filename: z.string().trim().min(1).max(200),
  fileBase64: z.string().min(16),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
});

/** Dépôt / mise à jour d'une pièce par le sous-traitant lui-même. */
export const uploadMyDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => MyUploadSchema.parse(i))
  .handler(async ({ data, context }) => {
    const m = await requireMembership(context.userId, data.companyId);
    // Garde d'abonnement canonique de l'entreprise donneuse d'ordre : en
    // lecture seule (essai expiré, impayé…), AUCUNE écriture n'est acceptée —
    // contrôle AVANT tout envoi Storage pour ne laisser aucun fichier orphelin.
    const { assertCompanyWritable } = await import("./subcontractor-guard.server");
    await assertCompanyWritable(m.companyId);

    const bytes = decodeBase64(data.fileBase64, MAX_BYTES);
    const mime = sniffDocumentMime(bytes);
    if (!mime) throw new Error("Format non accepté. Déposez un PDF, un JPG ou un PNG valide.");
    const ext = extensionForMime(mime);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Exigences = règles COURANTES de l'entreprise, jamais des valeurs client.
    const { data: rule } = await supabaseAdmin
      .from("subcontractor_document_rules")
      .select("is_required,is_blocking")
      .eq("company_id", m.companyId)
      .eq("subcontractor_company_id", m.subcontractorCompanyId)
      .eq("doc_type", data.docType)
      .maybeSingle();

    const path = `${m.companyId}/subcontractor-docs/${m.subcontractorCompanyId}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: mime, upsert: false });
    if (upErr) throw new Error("Envoi du fichier impossible, réessayez.");


    const { data: row, error } = await supabaseAdmin
      .from("subcontractor_documents")
      .insert({
        company_id: m.companyId,
        subcontractor_company_id: m.subcontractorCompanyId,
        doc_type: data.docType,
        storage_path: path,
        original_filename: data.filename,
        mime_type: mime,
        size_bytes: bytes.length,
        issue_date: data.issueDate || null,
        expiry_date: data.expiryDate || null,
        is_required: (rule as any)?.is_required ?? true,
        is_blocking: (rule as any)?.is_blocking ?? false,
        review_status: "pending_review",
        submitted_by_subcontractor_user_id: m.subcontractorUserId,
      } as never)
      .select("id")
      .single();
    if (error || !row) {
      await supabaseAdmin.storage.from(BUCKET).remove([path]);
      throw new Error("Enregistrement impossible.");
    }

    // Un dépôt « à vérifier » ne retire JAMAIS la couverture d'une version
    // déjà validée : la dernière `approved` active reste en vigueur pendant la
    // revue (elle sera archivée à l'APPROBATION de cette nouvelle version).
    // Seules les versions non approuvées (en attente / refusées) du même type
    // sont archivées, pour éviter d'empiler des doublons dans la file.
    const { data: replaced } = await supabaseAdmin
      .from("subcontractor_documents")
      .update({ archived_at: new Date().toISOString(), replaced_by_id: row.id } as never)
      .eq("company_id", m.companyId)
      .eq("subcontractor_company_id", m.subcontractorCompanyId)
      .eq("doc_type", data.docType)
      .is("archived_at", null)
      .neq("id", row.id)
      .in("review_status", ["pending_review", "rejected"])
      .select("id");


    const label = docTypeLabel(data.docType);
    await writeAuditLog({
      companyId: m.companyId,
      userId: context.userId,
      entityType: "subcontractor_document",
      entityId: row.id as string,
      action: "subcontractor_document.submitted",
      metadata: {
        summary: `${actorLabel(m)} a déposé ${label} (à vérifier).`,
        doc_type: data.docType,
        subcontractor_company_id: m.subcontractorCompanyId,
        expiry_date: data.expiryDate || null,
        replaced_document_ids: ((replaced ?? []) as any[]).map((r) => r.id),
        size_bytes: bytes.length,
        mime_type: mime,
        source: "subcontractor_portal",
      },
    });

    const { notifyCompanyAdmins } = await import("./subcontractor-notify.server");
    await notifyCompanyAdmins(m.companyId, {
      type: "subcontractor_document_submitted",
      title: `Pièce à vérifier — ${m.subcontractorCompanyName}`,
      body: `${label} a été déposée par ${m.subcontractorCompanyName}. À valider ou refuser.`,
      url: `/sous-traitants?partenaire=${m.subcontractorCompanyId}&onglet=documents`,
      tag: `sc-doc-submitted-${m.subcontractorCompanyId}`,
    });

    return { ok: true, id: row.id as string };
  });

/** Lien signé très court sur UNE pièce du sous-traitant connecté. */
export const getMyDocumentUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ companyId: z.string().uuid(), documentId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const m = await requireMembership(context.userId, data.companyId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: doc } = await supabaseAdmin
      .from("subcontractor_documents")
      .select("id,storage_path,original_filename,doc_type")
      .eq("id", data.documentId)
      .eq("company_id", m.companyId)
      .eq("subcontractor_company_id", m.subcontractorCompanyId)
      .maybeSingle();
    if (!doc) throw new Error("Document introuvable.");

    const { data: signed, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrl((doc as any).storage_path, SIGNED_URL_ADMIN_DOC_TTL);
    if (error || !signed?.signedUrl) throw new Error("Lien indisponible, réessayez.");

    return {
      url: signed.signedUrl,
      filename: (doc as any).original_filename as string,
      expiresIn: SIGNED_URL_ADMIN_DOC_TTL,
    };
  });

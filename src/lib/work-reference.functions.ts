import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Extraction automatique d'un devis / bon de commande / marché
 * via Lovable AI Gateway (Gemini multimodal).
 *
 * Workflow :
 *  1. Validation taille + MIME (PDF / image)
 *  2. Upload dans bucket `pv-assets` sous {company_id}/work-references/{draftKey}/{uuid}
 *  3. Appel Gemini avec le fichier en base64 → JSON structuré
 *  4. Insert pv_documents (extraction_status = success/failed)
 *  5. Audit log
 *
 * NB : ne jette pas si l'extraction IA échoue — on stocke quand même le document
 * pour saisie manuelle. Renvoie {extracted: null, status: 'failed'}.
 */

const MAX_BYTES = 10 * 1024 * 1024; // 10 Mo
const ALLOWED_MIMES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

const InputSchema = z.object({
  companyId: z.string().uuid(),
  draftKey: z.string().min(1).max(120).optional().nullable(),
  pvId: z.string().uuid().optional().nullable(),
  fileName: z.string().min(1).max(255),
  mimeType: z.enum(ALLOWED_MIMES),
  /** Data URL complet (data:<mime>;base64,...) OU base64 brut (normalisé côté serveur via mimeType). */
  dataUrl: z.string().min(8).max(20_000_000),
});

type ExtractedFields = {
  document_type?: "devis" | "bon_commande" | "marche" | "autre" | null;
  document_number?: string | null;
  document_date?: string | null; // ISO yyyy-mm-dd
  amount_ttc?: number | null;
  amount_ht?: number | null;
  vat_amount?: number | null;
  client_name?: string | null;
  client_email?: string | null;
  client_phone?: string | null;
  chantier_address?: string | null;
  chantier_postal_code?: string | null;
  chantier_city?: string | null;
  description?: string | null;
  issuer_company?: string | null;
  confidence?: number | null; // 0..1
};

function decodeDataUrl(dataUrl: string): { bytes: Uint8Array; mime: string } {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error("INVALID_DATA_URL");
  const mime = m[1];
  const b64 = m[2];
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, mime };
}

/** Sniff réel pour PDF / PNG / JPEG / WEBP. */
function sniffMime(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  // PDF "%PDF-"
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "application/pdf";
  // PNG
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  // JPEG
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  // WEBP : RIFF....WEBP
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return "image/webp";
  return null;
}

async function extractWithGemini(opts: {
  dataUrl: string;
  mimeType: string;
  fileName: string;
}): Promise<{ data: ExtractedFields | null; error?: string }> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) return { data: null, error: "LOVABLE_API_KEY_MISSING" };

  const systemPrompt = `Tu es un assistant d'extraction de données pour le secteur BTP français.
Analyse le document joint (devis, bon de commande, contrat de marché) et retourne UNIQUEMENT un objet JSON conforme au schéma.
Conventions :
- Dates au format ISO yyyy-mm-dd.
- Montants en nombres (ex 14720.5), pas de texte. Virgule décimale convertie en point.
- Si une information n'est pas présente, retourne null.
- confidence : note globale de fiabilité 0..1.
- document_type : "devis" | "bon_commande" | "marche" | "autre".`;

  const userContent: Array<Record<string, unknown>> = [
    { type: "text", text: `Fichier : ${opts.fileName}. Extrais les champs demandés.` },
  ];
  if (opts.mimeType === "application/pdf") {
    userContent.push({
      type: "file",
      file: { filename: opts.fileName, file_data: opts.dataUrl },
    });
  } else {
    userContent.push({ type: "image_url", image_url: { url: opts.dataUrl } });
  }

  const body = {
    model: "google/gemini-2.5-flash",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "work_reference_extraction",
        strict: false,
        schema: {
          type: "object",
          properties: {
            document_type: { type: ["string", "null"], enum: ["devis", "bon_commande", "marche", "autre", null] },
            document_number: { type: ["string", "null"] },
            document_date: { type: ["string", "null"] },
            amount_ttc: { type: ["number", "null"] },
            amount_ht: { type: ["number", "null"] },
            vat_amount: { type: ["number", "null"] },
            client_name: { type: ["string", "null"] },
            client_email: { type: ["string", "null"] },
            client_phone: { type: ["string", "null"] },
            chantier_address: { type: ["string", "null"] },
            chantier_postal_code: { type: ["string", "null"] },
            chantier_city: { type: ["string", "null"] },
            description: { type: ["string", "null"] },
            issuer_company: { type: ["string", "null"] },
            confidence: { type: ["number", "null"] },
          },
        },
      },
    },
  };

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": key,
        "X-Lovable-AIG-SDK": "raw-fetch",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { data: null, error: `AI_GATEWAY_${res.status}:${text.slice(0, 200)}` };
    }
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = json.choices?.[0]?.message?.content;
    if (!content) return { data: null, error: "AI_EMPTY_RESPONSE" };
    let parsed: ExtractedFields;
    try {
      parsed = JSON.parse(content);
    } catch {
      // Some models wrap JSON in ```json fences
      const m = content.match(/\{[\s\S]*\}/);
      if (!m) return { data: null, error: "AI_INVALID_JSON" };
      parsed = JSON.parse(m[0]);
    }
    return { data: parsed };
  } catch (e) {
    return { data: null, error: `AI_FETCH_FAILED:${(e as Error).message}` };
  }
}

export const extractWorkReferenceDoc = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => InputSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { writeAuditLog } = await import("./audit.server");

    // Authorisation : membre actif de la company
    const { data: member } = await supabaseAdmin
      .from("company_members")
      .select("id,role")
      .eq("company_id", data.companyId)
      .eq("user_id", context.userId)
      .eq("status", "active")
      .maybeSingle();
    if (!member) throw new Error("Accès refusé.");
    if (!["owner", "admin", "manager"].includes(member.role)) {
      throw new Error("Rôle insuffisant pour importer un document.");
    }

    // Normalise : accepte Data URL complet OU base64 brut (avec mimeType fourni)
    const normalizedDataUrl = data.dataUrl.startsWith("data:")
      ? data.dataUrl
      : `data:${data.mimeType};base64,${data.dataUrl}`;

    // Décode + valide MIME réel
    let bytes: Uint8Array;
    let declared: string;
    try {
      const decoded = decodeDataUrl(normalizedDataUrl);
      bytes = decoded.bytes;
      declared = decoded.mime;
    } catch {
      throw new Error("Le fichier n'a pas pu être lu. Réessayez avec un PDF ou une image valide.");
    }
    if (bytes.byteLength > MAX_BYTES) throw new Error("Fichier trop volumineux (max 10 Mo).");
    const sniffed = sniffMime(bytes);
    if (!sniffed) throw new Error("Le fichier n'a pas pu être lu. Réessayez avec un PDF ou une image valide.");
    if (sniffed !== declared || !ALLOWED_MIMES.includes(sniffed as (typeof ALLOWED_MIMES)[number])) {
      throw new Error("Type de fichier non autorisé.");
    }

    // Upload
    const ext = sniffed === "application/pdf" ? "pdf"
      : sniffed === "image/png" ? "png"
      : sniffed === "image/webp" ? "webp"
      : "jpg";
    const safeName = data.fileName.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 80);
    const subfolder = data.pvId ? `pv/${data.pvId}` : `drafts/${data.draftKey ?? "unknown"}`;
    const path = `${data.companyId}/work-references/${subfolder}/${crypto.randomUUID()}-${safeName}`;

    const { error: upErr } = await supabaseAdmin.storage
      .from("pv-assets")
      .upload(path, bytes, { contentType: sniffed, upsert: false });
    if (upErr) throw new Error(`Upload échoué : ${upErr.message}`);

    await writeAuditLog({
      companyId: data.companyId,
      userId: context.userId,
      pvId: data.pvId ?? null,
      entityType: "pv_document",
      action: "pv.update",
      metadata: {
        sub_action: "pv.work_reference_uploaded",
        file_name: safeName,
        mime: sniffed,
        size: bytes.byteLength,
        draft_key: data.draftKey ?? null,
      },
      actor: "user",
    });

    // Extraction IA
    const extracted = await extractWithGemini({
      dataUrl: data.dataUrl,
      mimeType: sniffed,
      fileName: safeName,
    });

    const status: "success" | "failed" = extracted.data ? "success" : "failed";
    const confidence =
      typeof extracted.data?.confidence === "number" ? extracted.data.confidence : null;

    // Insert document row
    const { data: docRow, error: insErr } = await supabaseAdmin
      .from("pv_documents")
      .insert({
        company_id: data.companyId,
        pv_id: data.pvId ?? null,
        draft_key: data.draftKey ?? null,
        file_path: path,
        file_url: path,
        file_name: safeName,
        file_type: sniffed,
        file_size: bytes.byteLength,
        document_type: extracted.data?.document_type ?? "autre",
        extracted_data: (extracted.data ?? null) as any,
        extraction_status: status,
        extraction_confidence: confidence,
        extraction_error: extracted.error ?? null,
        created_by: context.userId,
      })
      .select("id,file_name,file_type,extraction_status,extracted_data,extraction_confidence")
      .single();
    if (insErr) throw new Error(`Enregistrement échoué : ${insErr.message}`);

    await writeAuditLog({
      companyId: data.companyId,
      userId: context.userId,
      pvId: data.pvId ?? null,
      entityType: "pv_document",
      entityId: docRow.id,
      action: status === "success" ? "pv.update" : "pv.update",
      metadata: {
        sub_action: status === "success" ? "pv.work_reference_extracted" : "pv.work_reference_extraction_failed",
        confidence,
        error: extracted.error ?? null,
      },
      actor: "user",
    });

    const { data: signed } = await supabaseAdmin.storage
      .from("pv-assets")
      .createSignedUrl(path, 3600);

    return {
      document: {
        id: docRow.id,
        file_name: docRow.file_name,
        file_type: docRow.file_type,
        extraction_status: docRow.extraction_status as "success" | "failed",
        extraction_confidence: docRow.extraction_confidence,
        signed_url: signed?.signedUrl ?? null,
      },
      extracted: (extracted.data ?? null) as ExtractedFields | null,
      error: extracted.error ?? null,
    };
  });

/**
 * Persiste les choix utilisateur (appliqué / ignoré) sur un document
 * importé, dans pv_documents.extracted_data.applied_fields / ignored_fields,
 * et journalise l'événement d'audit.
 */
const ApplyInputSchema = z.object({
  documentId: z.string().uuid(),
  appliedFields: z.array(z.string().min(1).max(64)).max(64),
  ignoredFields: z.array(z.string().min(1).max(64)).max(64),
});

export const applyWorkReferenceFields = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ApplyInputSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { writeAuditLog } = await import("./audit.server");

    const { data: doc } = await supabaseAdmin
      .from("pv_documents")
      .select("id,company_id,pv_id,extracted_data")
      .eq("id", data.documentId)
      .maybeSingle();
    if (!doc) throw new Error("Document introuvable.");

    const { data: member } = await supabaseAdmin
      .from("company_members")
      .select("role")
      .eq("company_id", doc.company_id)
      .eq("user_id", context.userId)
      .eq("status", "active")
      .maybeSingle();
    if (!member || !["owner", "admin", "manager"].includes(member.role)) {
      throw new Error("Accès refusé.");
    }

    const current = (doc.extracted_data ?? {}) as Record<string, unknown>;
    const next = {
      ...current,
      applied_fields: data.appliedFields,
      ignored_fields: data.ignoredFields,
      applied_at: new Date().toISOString(),
    };

    const { error: upErr } = await supabaseAdmin
      .from("pv_documents")
      .update({ extracted_data: next as any })
      .eq("id", data.documentId);
    if (upErr) throw new Error(upErr.message);

    await writeAuditLog({
      companyId: doc.company_id,
      userId: context.userId,
      pvId: doc.pv_id,
      entityType: "pv_document",
      entityId: doc.id,
      action: "pv.update",
      metadata: {
        sub_action: "pv.work_reference_fields_applied",
        applied: data.appliedFields,
        ignored: data.ignoredFields,
      },
      actor: "user",
    });

    return { ok: true };
  });

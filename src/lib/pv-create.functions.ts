/**
 * createPv: server-side end-to-end PV creation.
 *
 * Replaces the client-side flow in /pv/new which previously did quota check,
 * client insert, PV insert, reserves, photo uploads, PDF generation and push
 * notifications directly from the browser.
 *
 * All side-effects happen here with service-role privileges after the
 * authenticated user has been verified as an active member of the company.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { writeAuditLog } from "./audit.server";
import { firePushToCompany } from "./push.server";
import { buildAndStorePvPdf } from "./pdf.server";
import { getCompanyBranding } from "./branding.server";
import {
  PHOTO_MAX_BYTES,
  PHOTO_MAX_COUNT,
  PHOTO_ALLOWED_MIMES,
  SIG_MAX_BYTES,
  sniffImageMime,
  decodeBase64,
  decodeDataUrlOrBase64,
  normMime,
  safeFilename,
} from "./pv-create.server";

const ReserveSchema = z.object({
  description: z.string().trim().min(1).max(2000),
  severity: z.enum(["mineure", "majeure"]),
  status: z.enum(["ouverte", "levee", "validee"]),
  nature: z.string().trim().max(200).optional().default(""),
  work_to_execute: z.string().trim().max(2000).optional().default(""),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

const PhotoSchema = z.object({
  base64: z.string().min(1).max(6_000_000),     // ~4.5 MB raw after decode
  mimeType: z.string().min(1).max(100),
  fileName: z.string().min(1).max(200),
  kind: z.enum(["avant", "apres", "autre"]).default("autre"),
  caption: z.string().max(500).optional().default(""),
});

const InputSchema = z.object({
  companyId: z.string().uuid(),
  status: z.enum(["brouillon", "signe"]),
  reception_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide"),
  chantier_id: z.string().uuid().nullable().optional(),
  client_id: z.string().uuid().nullable().optional(),
  new_client_name: z.string().trim().max(200).optional().default(""),
  new_client_email: z.string().trim().max(200).optional().default(""),
  description: z.string().trim().max(20_000).optional().default(""),
  observations: z.string().trim().max(20_000).optional().default(""),
  client_signature: z.string().max(800_000).nullable().optional(),
  company_signature: z.string().max(800_000).nullable().optional(),
  reserves: z.array(ReserveSchema).max(50).optional().default([]),
  photos: z.array(PhotoSchema).max(PHOTO_MAX_COUNT).optional().default([]),
  // --- Reception type & work reference (CAPEB-style) ---
  reception_with_reserves: z.boolean().optional().default(false),
  work_reference_type: z.enum(["devis", "bon_commande", "marche", "manuel"]).nullable().optional(),
  work_reference_number: z.string().trim().max(100).nullable().optional(),
  work_reference_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  work_reference_amount: z.number().nonnegative().nullable().optional(),
  reserve_completion_delay: z.string().trim().max(120).nullable().optional(),
  reserve_due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  // Chantier address snapshot (from autocomplete)
  chantier_address: z.string().trim().max(500).optional().default(""),
  chantier_postal_code: z.string().trim().max(20).optional().default(""),
  chantier_city: z.string().trim().max(200).optional().default(""),
});

export const createPv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => InputSchema.parse(i))
  .handler(async ({ data, context }) => {
    const userId = context.userId;

    // 1. Membership check
    const { data: member } = await supabaseAdmin
      .from("company_members")
      .select("role,status")
      .eq("company_id", data.companyId)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();
    if (!member) throw new Error("Accès refusé.");

    // 1a. Suspension + plan quota gate (throws COMPANY_SUSPENDED:* or SUBSCRIPTION_REQUIRED:*)
    const { assertCanCreatePv } = await import("./plan-guard.server");
    await assertCanCreatePv(data.companyId, userId);

    // 1b. Company branding completeness (server-authoritative)
    const branding = await getCompanyBranding(data.companyId);
    const hasAddress = !!(branding?.address_line1 || branding?.address);
    const hasIdent = !!(branding?.siret || branding?.siren);
    const hasContact = !!(branding?.email || branding?.phone);
    if (!branding?.name || !hasIdent || !hasAddress || !hasContact) {
      const err = new Error("Fiche entreprise incomplète. Complétez nom, SIRET/SIREN, adresse et contact.");
      (err as any).code = "COMPANY_INCOMPLETE";
      throw err;
    }

    // 2. Signed PV requires at least the company signature (client signature optional)
    if (data.status === "signe") {
      if (!data.company_signature) {
        const err = new Error("Signature entreprise requise pour valider le PV.");
        (err as any).code = "SIGNATURE_REQUIRED";
        throw err;
      }
    }

    // 2b. With/without reserves — server-authoritative invariant
    const withReserves = !!data.reception_with_reserves;
    let normalizedReserves = data.reserves;
    let normalizedPhotos = data.photos;
    if (!withReserves) {
      // Ignore any reserves/photos sent by a manipulated client.
      normalizedReserves = [];
      normalizedPhotos = [];
    } else {
      // At least one valid reserve required.
      const hasValid = normalizedReserves.some(
        (r) => r.description.trim().length > 0 && (r.work_to_execute ?? "").trim().length >= 0,
      );
      if (!hasValid) {
        throw new Error("Au moins une réserve avec description est requise.");
      }
    }
    // Rebind for the rest of the handler.
    (data as { reserves: typeof normalizedReserves }).reserves = normalizedReserves;
    (data as { photos: typeof normalizedPhotos }).photos = normalizedPhotos;

    // 3. Validate signature payloads (PNG data URL)
    const sigOrNull = (raw: string | null | undefined): string | null => {
      if (!raw) return null;
      if (raw.length > SIG_MAX_BYTES * 2) throw new Error("Signature trop volumineuse.");
      const { bytes, mime } = decodeDataUrlOrBase64(raw);
      if (bytes.length === 0) throw new Error("Signature invalide.");
      if (bytes.length > SIG_MAX_BYTES) throw new Error("Signature trop volumineuse.");
      const sniffed = sniffImageMime(bytes);
      if (sniffed !== "image/png") throw new Error("Signature : format PNG attendu.");
      // Normalise back to a data URL the DB column already accepts
      if (mime && normMime(mime) !== "image/png") throw new Error("Signature : format PNG attendu.");
      return raw;
    };
    const clientSig = sigOrNull(data.client_signature ?? null);
    const companySig = sigOrNull(data.company_signature ?? null);

    // 4. Validate photos (mime + magic-number + size)
    const photoBuffers: Array<{
      bytes: Uint8Array; mime: string; fileName: string; kind: string; caption: string;
    }> = [];
    for (const p of data.photos) {
      const declared = p.mimeType.toLowerCase();
      if (!PHOTO_ALLOWED_MIMES.has(declared)) {
        throw new Error(`Photo "${p.fileName}" : format non supporté (PNG, JPEG, WebP).`);
      }
      const bytes = decodeBase64(p.base64);
      if (bytes.length === 0) throw new Error(`Photo "${p.fileName}" : fichier vide.`);
      if (bytes.length > PHOTO_MAX_BYTES) {
        throw new Error(`Photo "${p.fileName}" : trop volumineuse (max 4 Mo).`);
      }
      const sniffed = sniffImageMime(bytes);
      if (!sniffed) throw new Error(`Photo "${p.fileName}" : contenu non reconnu.`);
      if (normMime(sniffed) !== normMime(declared)) {
        throw new Error(`Photo "${p.fileName}" : type déclaré incorrect.`);
      }
      photoBuffers.push({
        bytes,
        mime: normMime(sniffed),
        fileName: safeFilename(p.fileName),
        kind: p.kind,
        caption: p.caption ?? "",
      });
    }

    // 5. Authoritative quota check (uses subscriptions table via SQL fn)
    const { data: canCreate, error: quotaErr } = await supabaseAdmin
      .rpc("can_create_pv", { _company_id: data.companyId });
    if (quotaErr) throw new Error(quotaErr.message);
    if (!canCreate) {
      const err = new Error("Quota PV mensuel atteint ou abonnement requis.");
      (err as any).code = "PV_QUOTA";
      throw err;
    }

    // 6. Resolve / create client
    let clientId = data.client_id || null;
    if (!clientId && data.new_client_name.trim()) {
      const { data: nc, error: ncErr } = await supabaseAdmin
        .from("clients")
        .insert({
          owner_id: userId,
          company_id: data.companyId,
          name: data.new_client_name.trim(),
          email: data.new_client_email?.trim() || null,
        })
        .select("id")
        .single();
      if (ncErr) throw new Error(`Création client : ${ncErr.message}`);
      clientId = nc?.id ?? null;
    }

    // 7. Generate atomic PV number (server-authoritative) + insert PV.
    // One retry in the (impossible-via-RPC) case the unique constraint trips.
    const nowIso = new Date().toISOString();
    let pvIns: { id: string; numero: string; company_id: string | null; owner_id: string } | null = null;
    let lastErr: { message: string } | null = null;
    let assignedNumero = "";
    for (let attempt = 0; attempt < 2 && !pvIns; attempt++) {
      const { data: numRes, error: numErr } = await supabaseAdmin
        .rpc("generate_next_pv_number", { _company_id: data.companyId });
      if (numErr || !numRes) throw new Error(`Numérotation : ${numErr?.message ?? "indisponible"}`);
      assignedNumero = numRes as unknown as string;
      const { data: ins, error: pvErr } = await supabaseAdmin
        .from("pv")
        .insert({
          owner_id: userId,
          company_id: data.companyId,
          numero: assignedNumero,
          type: "reception",
          status: data.status,
          reception_date: data.reception_date,
          chantier_id: data.chantier_id || null,
          client_id: clientId,
          description: data.description || null,
          observations: data.observations || null,
          client_signature: clientSig,
          company_signature: companySig,
          signed_at: data.status === "signe" ? nowIso : null,
          reception_with_reserves: withReserves,
          work_reference_type: data.work_reference_type ?? null,
          work_reference_number: data.work_reference_number?.trim() || null,
          work_reference_date: data.work_reference_date ?? null,
          work_reference_amount: data.work_reference_amount ?? null,
          reserve_completion_delay: withReserves ? (data.reserve_completion_delay?.trim() || null) : null,
          reserve_due_date: withReserves ? (data.reserve_due_date ?? null) : null,
          chantier_address: data.chantier_address?.trim() || null,
          chantier_postal_code: data.chantier_postal_code?.trim() || null,
          chantier_city: data.chantier_city?.trim() || null,
        } as never)
        .select("id,numero,company_id,owner_id")
        .single();
      if (!pvErr && ins) { pvIns = ins; break; }
      lastErr = pvErr ?? { message: "inconnue" };
    }
    if (!pvIns) throw new Error(`Création PV : ${lastErr?.message ?? "inconnue"}`);

    const pvId = pvIns.id;

    // 8. Insert reserves (bulk)
    if (data.reserves.length) {
      const { error: resErr } = await supabaseAdmin
        .from("pv_reserves")
        .insert(
          data.reserves.map((r) => ({
            pv_id: pvId,
            owner_id: userId,
            company_id: data.companyId,
            description: r.description,
            severity: r.severity,
            status: r.status,
            nature: r.nature?.trim() || null,
            work_to_execute: r.work_to_execute?.trim() || null,
            due_date: r.due_date ?? null,
          })) as never,
        );
      if (resErr) {
        console.error("createPv: insert reserves failed", resErr);
      }
    }

    // 9. Upload photos via service role + insert pv_photos rows
    let uploadedPhotos = 0;
    for (const p of photoBuffers) {
      const ext = p.mime === "image/jpeg" ? "jpg" : p.mime === "image/png" ? "png" : "webp";
      const path = `${data.companyId}/pv/${pvId}/${p.kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabaseAdmin.storage
        .from("pv-assets")
        .upload(path, p.bytes, { contentType: p.mime, upsert: false });
      if (upErr) {
        console.error("createPv: upload photo failed", upErr);
        continue;
      }
      const { error: phErr } = await supabaseAdmin.from("pv_photos").insert({
        pv_id: pvId,
        owner_id: userId,
        company_id: data.companyId,
        url: path,
        caption: p.caption ? `[${p.kind}] ${p.caption}` : `[${p.kind}]`,
        kind: p.kind,
      });
      if (phErr) {
        console.error("createPv: insert pv_photos failed", phErr);
      } else {
        uploadedPhotos += 1;
      }
    }

    // 10. Generate signed PDF server-side (only when status is signed)
    let pdfPath: string | null = null;
    if (data.status === "signe") {
      try {
        pdfPath = await buildAndStorePvPdf(pvId);
      } catch (e) {
        console.error("createPv: PDF generation failed", e);
        // Don't fail the whole creation; PDF can be regenerated later.
      }
    }

    // 11. Audit log
    await writeAuditLog({
      companyId: data.companyId,
      userId,
      pvId,
      entityType: "pv",
      entityId: pvId,
      action: data.status === "signe" ? "pv.signed_by_company" : "pv.create",
      newValues: { numero: assignedNumero, type: "reception", status: data.status },
      metadata: {
        source: "web_form",
        photos: uploadedPhotos,
        reserves: data.reserves.length,
        pdf_generated: !!pdfPath,
        reception_with_reserves: withReserves,
      },
      actor: "user",
    });

    // 12. Push notification fan-out (best-effort)
    try {
      const title = data.status === "signe" ? "PV signé" : "Nouveau PV";
      const body = data.status === "signe"
        ? `Le PV ${pvIns.numero} a été signé.`
        : `Le PV ${pvIns.numero} vient d'être créé.`;
      firePushToCompany(
        data.companyId,
        {
          title,
          body,
          url: `/pv/${pvId}`,
          tag: `pv-${pvId}`,
          data: { kind: data.status === "signe" ? "pv.signed" : "pv.created", pvId },
        },
        { excludeUserId: userId },
      );
      await writeAuditLog({
        companyId: data.companyId,
        userId,
        pvId,
        entityType: "pv",
        entityId: pvId,
        action: "push.sent",
        metadata: { trigger: data.status === "signe" ? "pv.signed" : "pv.created", channel: "web_push" },
        actor: "push",
      });
    } catch (e) {
      console.error("createPv: push fan-out failed", e);
    }

    // Webhooks: emitted automatically by DB triggers on pv insert + signe.

    return {
      ok: true,
      pvId,
      pdfPath,
      uploadedPhotos,
      reservesCount: data.reserves.length,
    };
  });

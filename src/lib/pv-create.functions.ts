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

const PhotoSchema = z.object({
  base64: z.string().min(1).max(6_000_000),     // ~4.5 MB raw after decode
  mimeType: z.string().min(1).max(100),
  fileName: z.string().min(1).max(200),
  kind: z.enum(["avant", "apres", "autre", "reserve"]).default("autre"),
  caption: z.string().max(500).optional().default(""),
});

const ReserveSchema = z.object({
  description: z.string().trim().min(1).max(2000),
  severity: z.enum(["mineure", "majeure", "bloquante"]),
  status: z.enum(["ouverte", "en_cours", "levee", "en_attente_validation", "validee", "rejetee"]),
  nature: z.string().trim().max(200).optional().default(""),
  work_to_execute: z.string().trim().max(2000).optional().default(""),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  photos: z.array(PhotoSchema).max(20).optional().default([]),
});


const InputSchema = z.object({
  companyId: z.string().uuid(),
  status: z.enum(["brouillon", "signe", "en_attente"]),
  signature_mode: z.enum(["remote", "onsite"]).nullable().optional(),
  client_identity_email: z.string().trim().toLowerCase().email().max(255).nullable().optional(),
  client_otp_id: z.string().uuid().nullable().optional(),
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

    // 2. Status / signature mode coherence (server-authoritative).
    const sigMode = data.signature_mode ?? null;
    const status = data.status;
    type OtpRecord = { id: string; email: string; pv_id: string | null; company_id: string; used_at: string | null };
    let otpRecord: OtpRecord | null = null;
    if (status === "signe") {
      if (!data.company_signature) {
        const err = new Error("Signature entreprise requise pour valider le PV.");
        (err as any).code = "SIGNATURE_REQUIRED";
        throw err;
      }
      if (sigMode === "remote") {
        const err = new Error("Mode signature à distance : utilisez le statut en_attente puis l'envoi au client.");
        (err as any).code = "REMOTE_MUST_WAIT_CLIENT";
        throw err;
      }
      if (sigMode === "onsite") {
        if (!data.client_signature) {
          const err = new Error("Signature client requise (signature sur place).");
          (err as any).code = "CLIENT_SIGNATURE_REQUIRED";
          throw err;
        }
        if (!data.client_otp_id) {
          const err = new Error("Identité client non confirmée (OTP requis).");
          (err as any).code = "OTP_REQUIRED";
          throw err;
        }
        const { assertSignatureOtpVerified } = await import("./signature-otp.server");
        const otp = await assertSignatureOtpVerified({
          otpId: data.client_otp_id,
          expectedCompanyId: data.companyId,
          expectedMode: "onsite",
        });
        otpRecord = {
          id: otp.id,
          email: otp.email,
          pv_id: otp.pv_id,
          company_id: otp.company_id,
          used_at: otp.used_at,
        };
      }
    }
    if (status === "en_attente") {
      if (sigMode !== "remote") {
        throw new Error("Le statut en_attente est réservé à la signature à distance.");
      }
      if (!data.company_signature) {
        const err = new Error("Signature entreprise requise.");
        (err as any).code = "SIGNATURE_REQUIRED";
        throw err;
      }
      if (!data.client_identity_email) {
        const err = new Error("Email client requis pour l'envoi de la signature à distance.");
        (err as any).code = "CLIENT_EMAIL_REQUIRED";
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
      // At least one reserve with a non-empty description is required.
      // work_to_execute reste optionnel (validé par le schéma Zod en amont).
      const hasValid = normalizedReserves.some((r) => r.description.trim().length > 0);
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
          locked_at: data.status === "signe" ? nowIso : null,
          signature_mode: sigMode,
          client_identity_email: data.client_identity_email ?? otpRecord?.email ?? null,
          client_identity_verified_at: otpRecord ? nowIso : null,
          client_identity_verified_by: otpRecord ? "onsite_otp" : null,
          client_otp_verified: !!otpRecord,
          sent_to_email: data.status === "signe" ? (data.client_identity_email ?? otpRecord?.email ?? null) : null,
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

    // 8. Insert reserves (bulk) — WF-M1: capture failure, never silent.
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
        const { recordProcessingError } = await import("@/lib/processing-status.server");
        await recordProcessingError({
          table: "pv", id: pvId, companyId: data.companyId, pvId, userId,
          step: "insert_reserves",
          error: resErr,
          meta: { count: data.reserves.length },
          audit: { action: "pv.reserve_insert_failed", entityType: "pv" },
        });
      }
    }

    // 9. Upload photos via service role + insert pv_photos rows — WF-M (photo).
    let uploadedPhotos = 0;
    let failedPhotos = 0;
    for (const p of photoBuffers) {
      const ext = p.mime === "image/jpeg" ? "jpg" : p.mime === "image/png" ? "png" : "webp";
      const path = `${data.companyId}/pv/${pvId}/${p.kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabaseAdmin.storage
        .from("pv-assets")
        .upload(path, p.bytes, { contentType: p.mime, upsert: false });
      if (upErr) {
        failedPhotos += 1;
        const { recordProcessingError } = await import("@/lib/processing-status.server");
        await recordProcessingError({
          table: "pv", id: pvId, companyId: data.companyId, pvId, userId,
          step: "upload_photo",
          error: upErr,
          meta: { path, kind: p.kind },
          audit: { action: "pv.photo_upload_failed", entityType: "pv_photo" },
        });
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
        failedPhotos += 1;
        const { recordProcessingError } = await import("@/lib/processing-status.server");
        await recordProcessingError({
          table: "pv", id: pvId, companyId: data.companyId, pvId, userId,
          step: "insert_pv_photo_row",
          error: phErr,
          meta: { path, kind: p.kind },
          audit: { action: "pv.photo_row_insert_failed", entityType: "pv_photo" },
        });
      } else {
        uploadedPhotos += 1;
      }
    }
    if (failedPhotos > 0) {
      try {
        const { bumpPhotosFailed } = await import("@/lib/processing-status.server");
        await bumpPhotosFailed(pvId, failedPhotos);
      } catch {}
    }

    // 9b. Link OTP to PV for onsite mode
    if (otpRecord) {
      const { linkSignatureOtpToPv } = await import("./signature-otp.server");
      await linkSignatureOtpToPv(otpRecord.id, pvId);
    }

    // 10. Generate signed PDF server-side + auto-email — WF-M5/WF-M8.
    let pdfPath: string | null = null;
    if (data.status === "signe") {
      const { markPdfGenerationStatus, recordProcessingError } = await import("@/lib/processing-status.server");
      await markPdfGenerationStatus("pv", pvId, "pending");
      try {
        pdfPath = await buildAndStorePvPdf(pvId);
        await markPdfGenerationStatus("pv", pvId, "ok");
        await writeAuditLog({
          companyId: data.companyId,
          userId,
          pvId,
          entityType: "pv",
          entityId: pvId,
          action: "pv.pdf_generated",
          metadata: { trigger: "auto_after_onsite_sign", path: pdfPath },
          actor: "pdf",
        });
      } catch (e) {
        await markPdfGenerationStatus("pv", pvId, "failed");
        await recordProcessingError({
          table: "pv", id: pvId, companyId: data.companyId, pvId, userId,
          step: "build_signed_pdf",
          error: e,
          audit: { action: "pv.pdf_generation_failed", entityType: "pv" },
        });
      }
      if (pdfPath) {
        try {
          const { deliverSignedPv } = await import("./email.server");
          const res = await deliverSignedPv({ pvId, trigger: "auto" });
          const anyFail =
            res.client?.status === "failed" || res.company?.status === "failed";
          if (anyFail) {
            await recordProcessingError({
              table: "pv", id: pvId, companyId: data.companyId, pvId, userId,
              step: "send_signed_email",
              error: res.client?.error || res.company?.error || "unknown",
              meta: { client: res.client?.status, company: res.company?.status },
              audit: { action: "pv.signed_email_failed", entityType: "pv" },
            });
          }
        } catch (e) {
          await recordProcessingError({
            table: "pv", id: pvId, companyId: data.companyId, pvId, userId,
            step: "send_signed_email",
            error: e,
            audit: { action: "pv.signed_email_failed", entityType: "pv" },
          });
        }
      }
    }

    // 10b. Remote signature flow → generate sign token and email the link
    let remoteSignUrl: string | null = null;
    let remoteSignEmailStatus: "sent" | "failed" | "skipped" = "skipped";
    let remoteSignEmailError: string | null = null;
    if (data.status === "en_attente" && sigMode === "remote" && data.client_identity_email) {
      try {
        const { generateSignToken, sha256Hex } = await import("./sign-token.server");
        const token = generateSignToken();
        const tokenHash = await sha256Hex(token);
        const expiresAt = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString();
        // WF-M2: throw if sign token persist fails — otherwise the link is dead.
        const { error: tokErr } = await supabaseAdmin
          .from("pv")
          .update({
            sign_token: null,
            sign_token_hash: tokenHash,
            sign_token_expires_at: expiresAt,
            sent_to_client_at: new Date().toISOString(),
            sent_to_email: data.client_identity_email,
          } as never)
          .eq("id", pvId);
        if (tokErr) {
          await writeAuditLog({
            companyId: data.companyId, userId, pvId,
            entityType: "pv", entityId: pvId,
            action: "pv.sign_token_persist_failed",
            metadata: { error: tokErr.message },
            actor: "system",
          });
          throw new Error(`Échec persistance du lien de signature : ${tokErr.message}`);
        }
        const appUrl = (process.env.PUBLIC_APP_URL || "https://pvia.fr").replace(/\/$/, "");
        remoteSignUrl = `${appUrl}/sign/pv/${token}`;
        const { sendEmailWithRetryLog } = await import("@/lib/email-sender.server");
        const [{ data: company }, { data: clientRow }] = await Promise.all([
          supabaseAdmin.from("companies").select("name").eq("id", data.companyId).maybeSingle(),
          clientId ? supabaseAdmin.from("clients").select("name").eq("id", clientId).maybeSingle() : Promise.resolve({ data: null }),
        ]);
        const companyName = company?.name || "PVIA";
        const clientName = (clientRow as any)?.name || "Cher client";
        const expFr = new Date(expiresAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
        const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
        const html = `<!doctype html><html><body style="margin:0;background:#f6f7f9;font-family:-apple-system,sans-serif;color:#0f172a"><table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0"><tr><td align="center"><table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden"><tr><td style="padding:32px 40px;background:linear-gradient(135deg,#0f172a,#1e3a8a);color:#fff"><div style="font-size:13px;letter-spacing:2px;text-transform:uppercase;opacity:.7">PVIA · Signature électronique</div><div style="font-size:24px;font-weight:600;margin-top:8px">N° ${esc(assignedNumero)} à signer</div></td></tr><tr><td style="padding:32px 40px"><p style="font-size:15px;line-height:1.6">Bonjour ${esc(clientName)},</p><p style="font-size:15px;line-height:1.6"><strong>${esc(companyName)}</strong> vous transmet le procès-verbal <strong>${esc(assignedNumero)}</strong> pour signature électronique.</p><table cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:#1e3a8a"><a href="${remoteSignUrl}" style="display:inline-block;padding:14px 28px;color:#fff;text-decoration:none;font-weight:600">Consulter et signer →</a></td></tr></table><p style="margin-top:24px;font-size:12px;color:#94a3b8">Lien valable jusqu'au ${expFr}.</p></td></tr></table></td></tr></table></body></html>`;
        const sendRes = await sendEmailWithRetryLog({
          emailType: "pv_sign_link",
          companyId: data.companyId,
          pvId,
          retryable: true,
          payload: {
            from: process.env.RESEND_FROM_EMAIL || "PVIA <noreply@pvia.fr>",
            to: [data.client_identity_email],
            subject: `${companyName} — N° ${assignedNumero} à signer`,
            html,
          },
        });
        if (sendRes.status === "failed") {
          remoteSignEmailStatus = "failed";
          remoteSignEmailError = sendRes.error ?? "inconnue";
        } else {
          remoteSignEmailStatus = "sent";
        }
        await writeAuditLog({
          companyId: data.companyId,
          userId,
          pvId,
          entityType: "pv",
          entityId: pvId,
          action: remoteSignEmailStatus === "sent"
            ? "pv.remote_signature_sent"
            : "pv.remote_signature_send_failed",
          newValues: { sent_to_email: data.client_identity_email },
          metadata: { numero: assignedNumero, error: remoteSignEmailError },
          actor: "user",
        });
      } catch (e: any) {
        // Lien créé mais email indisponible : on ne masque plus l'erreur.
        remoteSignEmailStatus = "failed";
        remoteSignEmailError = e?.message ?? String(e);
        console.error("createPv: remote sign link send failed", e);
        await writeAuditLog({
          companyId: data.companyId,
          userId,
          pvId,
          entityType: "pv",
          entityId: pvId,
          action: "pv.remote_signature_send_failed",
          metadata: { numero: assignedNumero, error: remoteSignEmailError },
          actor: "user",
        });
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

    // 11b. Temporary admin debug audit for the signed PV finalization pipeline.
    if (data.status === "signe") {
      const [{ data: pvDebug }, { count: emailLogsCount }] = await Promise.all([
        supabaseAdmin
          .from("pv")
          .select("id,company_id,status,pdf_generation_status,processing_status,pdf_url,locked_at")
          .eq("id", pvId)
          .maybeSingle(),
        supabaseAdmin
          .from("email_logs")
          .select("id", { count: "exact", head: true })
          .eq("pv_id", pvId),
      ]);
      await writeAuditLog({
        companyId: data.companyId,
        userId,
        pvId,
        entityType: "pv",
        entityId: pvId,
        action: "pv.create_debug",
        metadata: {
          pvId,
          companyId: pvDebug?.company_id ?? data.companyId,
          status: pvDebug?.status ?? data.status,
          locked_at: pvDebug?.locked_at ?? null,
          pdf_generation_status: pvDebug?.pdf_generation_status ?? null,
          processing_status: pvDebug?.processing_status ?? null,
          pdf_url: pvDebug?.pdf_url ?? null,
          email_logs_count: emailLogsCount ?? 0,
          rls_read_error: null,
        },
        actor: "system",
      });
    }

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
      remoteSignUrl,
      remoteSignEmailStatus,
      remoteSignEmailError,
      signatureMode: sigMode,
      status: data.status,
    };
  });


/**
 * Reserve-lift (levée de réserves) server functions.
 */
import { createServerFn } from "@tanstack/react-start";
import { ADMIN_ROLES, OWNER_ROLES, SIGN_ROLES, isAdminRole, isManageRole } from "@/lib/roles";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { writeAuditLog } from "./audit.server";
import { firePushToCompany } from "./push.server";
import { buildAndStoreReserveLiftPdfs } from "./reserve-lift.server";
import { sha256OfBytes } from "./signature-proof.server";
import { deliverSignedReserveLift } from "./reserve-lift-email.server";
import { sendReserveLiftValidationRequestEmail } from "./reserve-lift-validation-email.server";
import { deliverReserveLiftAtSignature } from "./reserve-lift-signed-delivery.server";
import {
  PHOTO_ALLOWED_MIMES,
  PHOTO_MAX_BYTES,
  PHOTO_MAX_COUNT,
  SIG_MAX_BYTES,
  decodeBase64,
  decodeDataUrlOrBase64,
  normMime,
  safeFilename,
  sniffImageMime,
} from "./pv-create.server";

const PhotoSchema = z.object({
  base64: z.string().min(1).max(6_000_000),
  mimeType: z.string().min(1).max(100),
  fileName: z.string().min(1).max(200),
  photoType: z.enum(["before", "after"]).optional().default("after"),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  accuracy: z.number().min(0).max(1_000_000).nullable().optional(),
  takenAt: z.string().datetime().nullable().optional(),
  deviceInfo: z.string().max(500).nullable().optional(),
  exifMetadata: z.record(z.string(), z.any()).nullable().optional(),
});

const ItemSchema = z.object({
  reserveId: z.string().uuid(),
  comment: z.string().max(2000).optional().default(""),
  photos: z.array(PhotoSchema).max(PHOTO_MAX_COUNT * 2).optional().default([]),
});

const InputSchema = z.object({
  pvId: z.string().uuid(),
  status: z.enum(["brouillon", "signe"]),
  comment: z.string().max(5000).optional().default(""),
  requireClientSignature: z.boolean().optional().default(false),
  items: z.array(ItemSchema).min(1).max(50),
  companySignature: z.string().max(800_000).nullable().optional(),
  clientSignature: z.string().max(800_000).nullable().optional(),
  technicianSignature: z.string().max(800_000).nullable().optional(),
  technicianName: z.string().max(200).nullable().optional(),
  // Phase 1 — single intervenant signature + validation mode.
  // SECURITY (F-03): signer identity (name/role/email) is resolved server-side
  // from the authenticated session ONLY. The client cannot submit it.
  signerSignature: z.string().max(800_000).nullable().optional(),
  validationMode: z.enum(["on_site", "remote"]).optional().default("remote"),
  clientSignedOnSite: z.boolean().optional().default(false),
  // Phase 2 — OTP id for on-site client signature (verified before signing in the dialog).
  clientOtpId: z.string().uuid().nullable().optional(),
});

/** Distance between two GPS points in meters (haversine). */
function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}


function validateSignature(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (raw.length > SIG_MAX_BYTES * 2) throw new Error("Signature trop volumineuse.");
  const { bytes, mime } = decodeDataUrlOrBase64(raw);
  if (bytes.length === 0 || bytes.length > SIG_MAX_BYTES) throw new Error("Signature invalide.");
  if (sniffImageMime(bytes) !== "image/png") throw new Error("Signature : format PNG attendu.");
  if (mime && normMime(mime) !== "image/png") throw new Error("Signature : format PNG attendu.");
  return raw;
}

async function generateLiftNumber(pvId: string): Promise<string> {
  // WF-C3: atomic RPC under row lock; collisions still guarded by UNIQUE(pv_id, numero).
  const { data, error } = await supabaseAdmin.rpc(
    "generate_next_reserve_lift_number" as never,
    { p_pv_id: pvId } as never,
  );
  if (error) throw new Error(`Numéro: ${error.message}`);
  return String(data);
}

export const createReserveLift = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => InputSchema.parse(i))
  .handler(async ({ data, context }) => {
    const userId = context.userId;

    // 1. Resolve PV + company + permissions
    const { data: pv } = await supabaseAdmin
      .from("pv")
      .select("id,numero,company_id,owner_id")
      .eq("id", data.pvId)
      .maybeSingle();
    if (!pv?.company_id) throw new Error("PV introuvable.");

    const { data: member } = await supabaseAdmin
      .from("company_members")
      .select("role,status")
      .eq("company_id", pv.company_id)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();
    if (!member || !(SIGN_ROLES as readonly string[]).includes(member.role as string)) {
      throw new Error("Accès refusé : seul un manager peut créer une levée de réserves.");
    }

    // Suspension / billing gate.
    const { assertSubscriptionUsable } = await import("./plan-guard.server");
    await assertSubscriptionUsable(pv.company_id, userId);

    // 2. Validate signatures
    // Phase 1: prefer the new "intervenant" signature; fall back to legacy companySignature.
    const effectiveSignerSig = data.signerSignature ?? data.companySignature ?? null;
    if (data.status === "signe") {
      if (!effectiveSignerSig) throw new Error("Signature intervenant obligatoire.");
      if (data.validationMode === "on_site" && !data.clientSignature) {
        throw new Error("Signature client obligatoire (signature sur place).");
      }
      if (data.validationMode !== "on_site" && data.requireClientSignature && !data.clientSignature) {
        throw new Error("Signature client obligatoire selon vos paramètres.");
      }
    }
    const signerSig = validateSignature(effectiveSignerSig);
    const clientSig = validateSignature(data.clientSignature);
    const technicianSig = validateSignature(data.technicianSignature);
    // Mirror intervenant signature into legacy company_signature column for PDF/back-compat.
    const companySigForStorage = signerSig;

    // Phase 2 — On-site client signature requires a verified OTP (email link).
    let onsiteOtpEmail: string | null = null;
    if (data.status === "signe" && data.validationMode === "on_site" && clientSig) {
      if (!data.clientOtpId) {
        throw new Error("Vérification d'identité client obligatoire (code OTP).");
      }
      const { assertSignatureOtpVerified } = await import("./signature-otp.server");
      const otp = await assertSignatureOtpVerified({
        otpId: data.clientOtpId,
        expectedCompanyId: pv.company_id,
        expectedPvId: pv.id,
        expectedMode: "onsite",
      });
      onsiteOtpEmail = otp.email;
    }

    // SECURITY (F-03): resolve intervenant identity STRICTLY from the authenticated
    // session. Any signer name/role/email arriving in the payload is ignored.
    let resolvedSignerName: string | null = null;
    let resolvedSignerRole: string | null = member?.role ? String(member.role) : null;
    let resolvedSignerEmail: string | null = null;
    try {
      const { data: prof } = await supabaseAdmin
        .from("profiles")
        .select("full_name")
        .eq("id", userId)
        .maybeSingle();
      if (prof?.full_name) resolvedSignerName = prof.full_name;
      const { data: authUser } = await (supabaseAdmin as any).auth.admin.getUserById(userId);
      if (authUser?.user?.email) resolvedSignerEmail = authUser.user.email;
    } catch { /* best-effort */ }

    // 3. Verify reserves belong to this PV + are open
    const reserveIds = data.items.map((i) => i.reserveId);
    const { data: reserves } = await supabaseAdmin
      .from("pv_reserves")
      .select("id,status,pv_id,company_id,description,severity")
      .in("id", reserveIds);
    const reserveById = new Map((reserves ?? []).map((r) => [r.id, r]));
    for (const id of reserveIds) {
      const r = reserveById.get(id);
      if (!r) throw new Error("Réserve introuvable.");
      if (r.pv_id !== data.pvId) throw new Error("Réserve liée à un autre PV.");
      if (r.company_id !== pv.company_id) throw new Error("Accès refusé.");
    }

    // 4. Generate numero + insert report with retry on UNIQUE collision (race-safe)
    const nowIso = new Date().toISOString();
    let report: { id: string; numero: string } | null = null;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const numero = await generateLiftNumber(pv.id);
      const { data: ins, error: insErr } = await supabaseAdmin
        .from("reserve_lift_reports")
        .insert({
          company_id: pv.company_id,
          pv_id: pv.id,
          numero,
          status: data.status,
          comment: data.comment || null,
          company_signature: companySigForStorage,
          client_signature: clientSig,
          technician_signature: technicianSig,
          technician_name: data.technicianName?.trim() || null,
          require_client_signature: data.requireClientSignature,
          signed_at: data.status === "signe" ? nowIso : null,
          created_by: userId,
          // New intervenant + validation-mode fields
          signer_user_id: userId,
          signer_name: resolvedSignerName,
          signer_role: resolvedSignerRole,
          signer_email: resolvedSignerEmail,
          signer_signature: signerSig,
          signer_signed_at: data.status === "signe" ? nowIso : null,
          validation_mode: data.validationMode ?? "remote",
          client_signed_on_site: !!data.clientSignedOnSite && !!clientSig,
          // On-site flow: record client validation timestamps right away.
          client_validated_at:
            data.validationMode === "on_site" && clientSig ? nowIso : null,
          client_validated_email:
            data.validationMode === "on_site" && clientSig
              ? (onsiteOtpEmail ?? resolvedSignerEmail)
              : null,
          client_signature_email:
            data.validationMode === "on_site" && clientSig ? onsiteOtpEmail : null,
          client_signature_otp_id:
            data.validationMode === "on_site" && clientSig ? (data.clientOtpId ?? null) : null,
          client_signed_at:
            data.validationMode === "on_site" && clientSig ? nowIso : null,
        } as any)
        .select("id,numero")
        .single();


      if (!insErr && ins) { report = ins as { id: string; numero: string }; break; }
      lastErr = insErr;
      const code = (insErr as { code?: string } | null)?.code;
      if (code === "23505") {
        // Collision : another request just took this number. Retry with a fresh one.
        await writeAuditLog({
          companyId: pv.company_id,
          userId,
          pvId: pv.id,
          entityType: "reserve_lift",
          action: "reserve_lift.number_collision",
          metadata: { attempted_numero: numero, attempt: attempt + 1 },
          actor: "user",
        });
        continue;
      }
      break;
    }
    if (!report) throw new Error(`Création levée: ${(lastErr as { message?: string } | null)?.message ?? "inconnue"}`);
    const reportId = report.id;
    const numero = report.numero;

    // 6. Validate + upload item photos, insert items — WF-M3: item insert errors are no longer silent.
    const { recordProcessingError, markPdfGenerationStatus } = await import("@/lib/processing-status.server");
    for (const item of data.items) {
      const photoPaths: string[] = [];
      const photoRows: Array<{
        path: string;
        photoType: "before" | "after";
        latitude: number | null;
        longitude: number | null;
        accuracy: number | null;
        takenAt: string | null;
        deviceInfo: string | null;
        exifMetadata: Record<string, any> | null;
        fileHash: string;
        fileSize: number;
        fileName: string;
      }> = [];
      for (const p of item.photos) {
        const declared = p.mimeType.toLowerCase();
        if (!PHOTO_ALLOWED_MIMES.has(declared)) {
          throw new Error(`Photo "${p.fileName}" : format non supporté.`);
        }
        const bytes = decodeBase64(p.base64);
        if (bytes.length === 0 || bytes.length > PHOTO_MAX_BYTES) {
          throw new Error(`Photo "${p.fileName}" : volumineuse ou vide.`);
        }
        const sniffed = sniffImageMime(bytes);
        if (!sniffed || normMime(sniffed) !== normMime(declared)) {
          throw new Error(`Photo "${p.fileName}" : type incorrect.`);
        }
        const ext = sniffed === "image/jpeg" ? "jpg" : sniffed === "image/png" ? "png" : "webp";
        const path = `${pv.company_id}/lifts/${reportId}/${item.reserveId}-${p.photoType ?? "after"}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error: upErr } = await supabaseAdmin.storage
          .from("pv-assets")
          .upload(path, bytes, { contentType: normMime(sniffed), upsert: false });
        if (upErr) {
          await recordProcessingError({
            table: "reserve_lift_reports", id: reportId, companyId: pv.company_id, pvId: pv.id, userId,
            step: "upload_item_photo",
            error: upErr,
            meta: { path, reserve_id: item.reserveId },
            audit: { action: "pv.photo_upload_failed", entityType: "reserve_lift_item" },
          });
          continue;
        }
        photoPaths.push(path);
        const fileHash = await sha256OfBytes(bytes);
        photoRows.push({
          path,
          photoType: (p.photoType ?? "after") as "before" | "after",
          latitude: p.latitude ?? null,
          longitude: p.longitude ?? null,
          accuracy: p.accuracy ?? null,
          takenAt: p.takenAt ?? null,
          deviceInfo: p.deviceInfo ?? null,
          exifMetadata: p.exifMetadata ?? null,
          fileHash,
          fileSize: bytes.length,
          fileName: safeFilename(p.fileName),
        });
      }

      const reserve = reserveById.get(item.reserveId)!;
      const { data: insertedItem, error: itemErr } = await supabaseAdmin.from("reserve_lift_items").insert({
        report_id: reportId,
        reserve_id: item.reserveId,
        old_status: reserve.status,
        new_status: "levee",
        comment: item.comment || null,
        photo_urls: photoPaths,
      } as any).select("id").single();
      if (itemErr || !insertedItem) {
        await recordProcessingError({
          table: "reserve_lift_reports", id: reportId, companyId: pv.company_id, pvId: pv.id, userId,
          step: "insert_lift_item",
          error: itemErr,
          meta: { reserve_id: item.reserveId },
          audit: { action: "reserve_lift.item_insert_failed", entityType: "reserve_lift_item" },
        });
        continue;
      }

      // Persist per-photo metadata in the dedicated table.
      if (photoRows.length) {
        const rowsToInsert = photoRows.map((row) => ({
          company_id: pv.company_id,
          pv_id: pv.id,
          reserve_id: item.reserveId,
          reserve_lift_item_id: insertedItem.id,
          photo_url: row.path,
          storage_path: row.path,
          photo_type: row.photoType,
          latitude: row.latitude,
          longitude: row.longitude,
          accuracy: row.accuracy,
          taken_at: row.takenAt,
          uploaded_by: userId,
          device_info: row.deviceInfo,
          exif_metadata: row.exifMetadata,
          file_hash: row.fileHash,
          file_size: row.fileSize,
          file_name: row.fileName,
        }));
        const { error: phErr } = await supabaseAdmin.from("reserve_lift_item_photos" as any).insert(rowsToInsert as any);
        if (phErr) {
          await recordProcessingError({
            table: "reserve_lift_reports", id: reportId, companyId: pv.company_id, pvId: pv.id, userId,
            step: "insert_lift_item_photos",
            error: phErr,
            meta: { reserve_id: item.reserveId, photo_count: photoRows.length },
            audit: { action: "reserve_lift_photo.insert_failed", entityType: "reserve_lift_photo" },
          });
        } else {
          // Audit per photo (exif detection + geo + anti-fraud signals)
          for (const row of photoRows) {
            const geoRecorded = row.latitude !== null && row.longitude !== null;
            const exif = (row.exifMetadata ?? {}) as Record<string, any>;
            const exifDetected = exif && Object.keys(exif).some((k) => k !== "gps_source" && k !== "browser_gps");
            const browserGps = exif?.browser_gps as { latitude: number | null; longitude: number | null } | undefined;
            const exifLat = typeof exif?.latitude === "number" ? exif.latitude : null;
            const exifLng = typeof exif?.longitude === "number" ? exif.longitude : null;

            // Suspicious checks
            const suspicious: string[] = [];
            if (browserGps?.latitude != null && exifLat != null && exifLng != null && browserGps.longitude != null) {
              const dist = haversineMeters(browserGps.latitude, browserGps.longitude, exifLat, exifLng);
              if (dist > 100) suspicious.push(`gps_mismatch_${Math.round(dist)}m`);
            }
            if (row.takenAt) {
              const t = new Date(row.takenAt).getTime();
              const now = Date.now();
              if (!isNaN(t) && (t > now + 5 * 60_000 || t < now - 365 * 24 * 3600_000)) {
                suspicious.push("exif_date_inconsistent");
              }
            }

            await writeAuditLog({
              companyId: pv.company_id,
              userId,
              pvId: pv.id,
              entityType: "reserve_lift_photo",
              entityId: item.reserveId,
              action: exifDetected ? "reserve_lift_photo.exif_detected" : "reserve_lift_photo.exif_missing",
              metadata: {
                photo_type: row.photoType,
                gps_source: exif?.gps_source ?? "none",
                accuracy: row.accuracy,
                geo_recorded: geoRecorded,
                camera_make: exif?.Make ?? null,
                camera_model: exif?.Model ?? null,
                report_id: reportId,
              },
              actor: "user",
            });
            if (suspicious.length) {
              await writeAuditLog({
                companyId: pv.company_id,
                userId,
                pvId: pv.id,
                entityType: "reserve_lift_photo",
                entityId: item.reserveId,
                action: "reserve_lift_photo.suspicious_metadata",
                metadata: { signals: suspicious, report_id: reportId, photo_type: row.photoType },
                actor: "user",
              });
            }
          }
        }
      }
    }


    // 7. Update each reserve to status=levee — WF-M4.
    if (reserveIds.length) {
      const { error: upResErr } = await supabaseAdmin
        .from("pv_reserves")
        .update({ status: "levee" })
        .in("id", reserveIds);
      if (upResErr) {
        await recordProcessingError({
          table: "reserve_lift_reports", id: reportId, companyId: pv.company_id, pvId: pv.id, userId,
          step: "update_reserves_status",
          error: upResErr,
          meta: { reserve_ids: reserveIds },
          audit: { action: "reserve_lift.reserves_update_failed", entityType: "reserve_lift" },
        });
      }
    }

    // 8. Generate PDF if signed — WF-M5.
    let pdfPath: string | null = null;
    if (data.status === "signe") {
      await markPdfGenerationStatus("reserve_lift_reports", reportId, "pending");
      try {
        const built = await buildAndStoreReserveLiftPdfs(reportId);
        pdfPath = built.clientPath;
        await markPdfGenerationStatus("reserve_lift_reports", reportId, "ok");
      } catch (e) {
        await markPdfGenerationStatus("reserve_lift_reports", reportId, "failed");
        await recordProcessingError({
          table: "reserve_lift_reports", id: reportId, companyId: pv.company_id, pvId: pv.id, userId,
          step: "build_lift_pdf",
          error: e,
          audit: { action: "reserve_lift.pdf_generation_failed", entityType: "reserve_lift" },
        });
      }

      // EM-B1: post-signature email automation.
      //  - on_site : send signed PDF to client + internal copy to company.
      //  - remote  : send client validation link + internal copy to company.
      if (data.validationMode !== "on_site") {
        try {
          await sendReserveLiftValidationRequestEmail({ reportId });
        } catch (e) {
          await recordProcessingError({
            table: "reserve_lift_reports", id: reportId, companyId: pv.company_id, pvId: pv.id, userId,
            step: "send_validation_email",
            error: e,
            audit: { action: "reserve_lift.validation_email_failed", entityType: "reserve_lift" },
          });
        }
      }
      try {
        await deliverReserveLiftAtSignature({
          reportId,
          mode: data.validationMode === "on_site" ? "on_site" : "remote",
        });
      } catch (e) {
        await recordProcessingError({
          table: "reserve_lift_reports", id: reportId, companyId: pv.company_id, pvId: pv.id, userId,
          step: "send_signed_emails",
          error: e,
          audit: { action: "reserve_lift.email_company_failed", entityType: "reserve_lift" },
        });
      }
    }

    // 9. Audit
    await writeAuditLog({
      companyId: pv.company_id,
      userId,
      pvId: pv.id,
      entityType: "reserve_lift",
      entityId: reportId,
      action: data.status === "signe" ? "reserve_lift.signed" : "reserve_lift.created",
      newValues: { numero, status: data.status, items: reserveIds.length },
      metadata: { pdf_generated: !!pdfPath },
      actor: "user",
    });
    for (const rid of reserveIds) {
      await writeAuditLog({
        companyId: pv.company_id,
        userId,
        pvId: pv.id,
        entityType: "reserve",
        entityId: rid,
        action: "reserve.lifted",
        metadata: { via: "reserve_lift", report_id: reportId },
        actor: "user",
      });
    }

    // 10. Check if all reserves lifted → audit + webhook
    const { count: stillOpen } = await supabaseAdmin
      .from("pv_reserves")
      .select("id", { count: "exact", head: true })
      .eq("pv_id", pv.id)
      .eq("status", "ouverte");
    if ((stillOpen ?? 0) === 0) {
      await writeAuditLog({
        companyId: pv.company_id,
        userId,
        pvId: pv.id,
        entityType: "pv",
        entityId: pv.id,
        action: "pv.all_reserves_lifted",
        actor: "user",
      });
    }

    // 11. Push
    try {
      const title = data.status === "signe" ? "Levée de réserves signée" : "Levée de réserves créée";
      const body = `${numero} pour le PV ${pv.numero}`;
      firePushToCompany(
        pv.company_id,
        { title, body, url: `/pv/${pv.id}`, tag: `lift-${reportId}`, data: { kind: "reserve_lift", reportId, pvId: pv.id } },
        { excludeUserId: userId },
      );
      await writeAuditLog({
        companyId: pv.company_id,
        userId,
        pvId: pv.id,
        entityType: "reserve_lift",
        entityId: reportId,
        action: "push.sent",
        metadata: { trigger: data.status === "signe" ? "reserve_lift.signed" : "reserve_lift.created" },
        actor: "push",
      });
    } catch (e) {
      console.error("reserve-lift: push failed", e);
    }

    return { ok: true, reportId, numero, pdfPath };
  });

export const listReserveLifts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ pvId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: pv } = await supabaseAdmin.from("pv").select("company_id").eq("id", data.pvId).maybeSingle();
    if (!pv?.company_id) throw new Error("PV introuvable.");
    const { data: m } = await supabaseAdmin
      .from("company_members")
      .select("id")
      .eq("company_id", pv.company_id)
      .eq("user_id", context.userId)
      .eq("status", "active")
      .maybeSingle();
    if (!m) throw new Error("Accès refusé.");
    const { data: rows } = await supabaseAdmin
      .from("reserve_lift_reports")
      .select("id,numero,status,signed_at,pdf_url,pdf_internal_url,pdf_client_url,created_at,client_validated_at,client_validated_email")
      .eq("pv_id", data.pvId)
      .order("created_at", { ascending: false });
    return { lifts: rows ?? [] };
  });

/**
 * Signed download URL for a reserve-lift PDF.
 *
 * Company members only. `variant` defaults to "client" so legacy callers
 * never accidentally surface internal forensic metadata. The "internal"
 * variant is gated on company membership too (RLS-aligned) and audited
 * separately so download events can be traced for assurance / litigation.
 */
export const getReserveLiftPdfUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      reportId: z.string().uuid(),
      variant: z.enum(["internal", "client"]).optional().default("client"),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: r } = await supabaseAdmin
      .from("reserve_lift_reports")
      .select("company_id,pv_id,numero,pdf_url,pdf_internal_url,pdf_client_url")
      .eq("id", data.reportId)
      .maybeSingle();
    if (!r?.company_id) throw new Error("Levée introuvable.");
    const { data: m } = await supabaseAdmin
      .from("company_members")
      .select("id")
      .eq("company_id", r.company_id)
      .eq("user_id", context.userId)
      .eq("status", "active")
      .maybeSingle();
    if (!m) throw new Error("Accès refusé.");

    // Prefer the requested variant; fall back to the legacy `pdf_url` only for
    // the client variant (the legacy column was always built without GPS gating).
    const path = data.variant === "internal"
      ? (r as any).pdf_internal_url
      : ((r as any).pdf_client_url ?? r.pdf_url);
    if (!path) {
      throw new Error(
        data.variant === "internal"
          ? "PDF interne indisponible. Régénérez la levée pour produire les deux versions."
          : "PDF client indisponible.",
      );
    }

    const { data: signed } = await supabaseAdmin.storage.from("pv-assets").createSignedUrl(path, 3600);
    if (!signed?.signedUrl) throw new Error("Lien indisponible.");

    await writeAuditLog({
      companyId: r.company_id,
      userId: context.userId,
      pvId: (r as any).pv_id,
      entityType: "reserve_lift",
      entityId: data.reportId,
      action: data.variant === "internal" ? "pdf.internal_downloaded" : "pdf.client_downloaded",
      metadata: { numero: (r as any).numero, path },
      actor: "user",
    });

    return { url: signed.signedUrl, variant: data.variant };
  });

/**
 * Resend the client-validated reserve-lift PDF email to client + company copy.
 * Owner/admin/manager only. Report must be `client_validated`.
 */
export const resendValidatedReserveLiftEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ reportId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    const { data: report } = await supabaseAdmin
      .from("reserve_lift_reports")
      .select("id,company_id,pv_id,numero,status,client_validated_at,pdf_url")
      .eq("id", data.reportId)
      .maybeSingle();
    if (!report) throw new Error("Levée introuvable.");
    if (!report.client_validated_at || report.status !== "client_validated") {
      throw new Error("Cette levée n'est pas encore validée par le client.");
    }
    const { data: member } = await supabaseAdmin
      .from("company_members")
      .select("role,status")
      .eq("company_id", report.company_id)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();
    if (!member || !(SIGN_ROLES as readonly string[]).includes(member.role as string)) {
      throw new Error("Accès refusé.");
    }

    // Ensure PDF exists (regenerate if missing)
    if (!report.pdf_url) {
      try {
        await buildAndStoreReserveLiftPdfs(report.id);
      } catch (e: any) {
        throw new Error(`Régénération PDF échouée : ${e?.message ?? "inconnue"}`);
      }
    }

    // EM-M2: throttle manual resends to one per minute per report.
    const { assertNotRecentlySent } = await import("@/lib/email-throttle.server");
    await assertNotRecentlySent({
      emailType: "reserve_lift_client_validated",
      pvId: report.pv_id,
      windowSec: 60,
      label: "L'email de la levée validée",
    });

    await deliverSignedReserveLift({ reportId: report.id });

    await writeAuditLog({
      companyId: report.company_id,
      userId,
      pvId: report.pv_id,
      entityType: "reserve_lift",
      entityId: report.id,
      action: "reserve_lift.client_validated_email_resent",
      metadata: { numero: report.numero },
      actor: "user",
    });

    return { ok: true as const };
  });

/**
 * EM-C1 — Manual "resend validation request" trigger from /pv/:id.
 * Owner/admin/manager only. Report must be signed (status='signe') and
 * not yet client-validated.
 */
export const resendReserveLiftValidationEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ reportId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    const { data: report } = await supabaseAdmin
      .from("reserve_lift_reports")
      .select("id,company_id,pv_id,status,client_validated_at")
      .eq("id", data.reportId)
      .maybeSingle();
    if (!report) throw new Error("Levée introuvable.");
    if (report.status !== "signe") throw new Error("La levée doit être signée par l'entreprise.");
    if (report.client_validated_at) throw new Error("La levée est déjà validée par le client.");

    const { data: member } = await supabaseAdmin
      .from("company_members")
      .select("role,status")
      .eq("company_id", report.company_id)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();
    if (!member || !(SIGN_ROLES as readonly string[]).includes(member.role as string)) {
      throw new Error("Accès refusé.");
    }

    // EM-M2: throttle manual resends.
    const { assertNotRecentlySent } = await import("@/lib/email-throttle.server");
    await assertNotRecentlySent({
      emailType: "reserve_lift_request",
      pvId: report.pv_id,
      windowSec: 60,
      label: "La demande de validation",
    });

    const res = await sendReserveLiftValidationRequestEmail({ reportId: report.id });
    if (!res.ok) throw new Error(res.error || "Envoi échoué.");
    return { ok: true as const, recipient: res.recipient };
  });

/**
 * EM-B1 — Unified "Renvoyer au client" trigger.
 *
 * Picks the right email based on report state:
 *  - signed remote, not yet validated → resend validation request link
 *  - signed on-site OR client-validated → resend signed PDF (client + company copy)
 */
export const resendReserveLiftClientEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ reportId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    const { data: report } = await supabaseAdmin
      .from("reserve_lift_reports")
      .select("id,company_id,pv_id,status,validation_mode,client_validated_at,pdf_client_url,pdf_url")
      .eq("id", data.reportId)
      .maybeSingle();
    if (!report) throw new Error("Levée introuvable.");
    if (report.status !== "signe" && report.status !== "client_validated") {
      throw new Error("La levée doit être signée par l'entreprise.");
    }
    const { data: member } = await supabaseAdmin
      .from("company_members")
      .select("role,status")
      .eq("company_id", report.company_id)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();
    if (!member || !(SIGN_ROLES as readonly string[]).includes(member.role as string)) {
      throw new Error("Accès refusé.");
    }

    const { assertNotRecentlySent } = await import("@/lib/email-throttle.server");

    // Remote + not validated → validation link
    if (report.validation_mode !== "on_site" && !report.client_validated_at) {
      await assertNotRecentlySent({
        emailType: "reserve_lift_request",
        pvId: report.pv_id,
        windowSec: 60,
        label: "La demande de validation",
      });
      const res = await sendReserveLiftValidationRequestEmail({ reportId: report.id });
      if (!res.ok) throw new Error(res.error || "Envoi échoué.");
      return { ok: true as const, kind: "validation_request" as const, recipient: res.recipient };
    }

    // On-site OR already validated → resend signed PDF
    await assertNotRecentlySent({
      emailType: report.client_validated_at ? "reserve_lift_client_validated" : "reserve_lift_signed_client",
      pvId: report.pv_id,
      windowSec: 60,
      label: "L'email du PDF signé",
    });

    // Ensure PDFs exist
    if (!report.pdf_client_url && !report.pdf_url) {
      try {
        await buildAndStoreReserveLiftPdfs(report.id);
      } catch (e: any) {
        throw new Error(`Régénération PDF échouée : ${e?.message ?? "inconnue"}`);
      }
    }

    if (report.client_validated_at) {
      await deliverSignedReserveLift({ reportId: report.id });
    } else {
      await deliverReserveLiftAtSignature({ reportId: report.id, mode: "on_site" });
    }

    await writeAuditLog({
      companyId: report.company_id,
      userId,
      pvId: report.pv_id,
      entityType: "reserve_lift",
      entityId: report.id,
      action: "reserve_lift.signed_email_resent",
      metadata: { validation_mode: report.validation_mode, client_validated: !!report.client_validated_at },
      actor: "user",
    });

    return { ok: true as const, kind: "signed_pdf" as const };
  });

/**
 * Lot C — Controlled reopening of a signed reserve-lift report.
 *
 * Allowed strictly to directeur / responsable_exploitation, and ONLY before
 * the client has signed, validated or rejected the lift. Resets the report
 * to `en_cours`, wipes signatures + PDFs (best-effort storage cleanup) and
 * writes audits `reserve_lift.reopened` + `reserve_lift.status_changed`.
 */
export const reopenReserveLiftReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ reportId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    const { data: report } = await supabaseAdmin
      .from("reserve_lift_reports")
      .select(
        "id,company_id,pv_id,status,client_signature,client_validated_at,client_rejected_at,pdf_url,pdf_client_url,pdf_internal_url",
      )
      .eq("id", data.reportId)
      .maybeSingle();
    if (!report) throw new Error("Levée introuvable.");
    if (report.client_validated_at)
      throw new Error("Cette levée a déjà été validée par le client — réouverture impossible.");
    if (report.client_rejected_at)
      throw new Error("Cette levée a été rejetée par le client — créez une nouvelle tentative.");
    if (report.client_signature)
      throw new Error("Signature client présente — réouverture impossible.");

    const { data: member } = await supabaseAdmin
      .from("company_members")
      .select("role,status")
      .eq("company_id", report.company_id)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();
    const role = String(member?.role ?? "");
    if (!["directeur", "responsable_exploitation"].includes(role)) {
      throw new Error(
        "Accès refusé : seul un directeur ou un responsable d'exploitation peut réouvrir une levée.",
      );
    }

    // Best-effort cleanup of stored PDFs so the report doesn't leak stale documents.
    const toRemove = [report.pdf_url, (report as any).pdf_client_url, (report as any).pdf_internal_url]
      .filter((p): p is string => typeof p === "string" && p.length > 0);
    if (toRemove.length) {
      try {
        await supabaseAdmin.storage.from("pv-assets").remove(toRemove);
      } catch (e) {
        console.warn("[reopenReserveLiftReport] storage cleanup failed", e);
      }
    }

    const { error: upErr } = await supabaseAdmin
      .from("reserve_lift_reports")
      .update({
        status: "en_cours",
        pdf_url: null,
        pdf_client_url: null,
        pdf_internal_url: null,
        signer_signature: null,
        company_signature: null,
        technician_signature: null,
        client_signature_otp_id: null,
        signed_at: null,
        signer_signed_at: null,
      } as never)
      .eq("id", report.id);
    if (upErr) throw new Error(upErr.message);

    await writeAuditLog({
      companyId: report.company_id,
      userId,
      pvId: report.pv_id,
      entityType: "reserve_lift",
      entityId: report.id,
      action: "reserve_lift.reopened",
      metadata: { previous_status: report.status, role },
      actor: "user",
    });
    await writeAuditLog({
      companyId: report.company_id,
      userId,
      pvId: report.pv_id,
      entityType: "reserve_lift",
      entityId: report.id,
      action: "reserve_lift.status_changed",
      metadata: { from: report.status, to: "en_cours" },
      actor: "user",
    });

    return { ok: true as const };
  });

/**
 * List photos (before/after) for a given reserve, with signed URLs.
 * Company-scoped via RLS; signed URLs valid 1h.
 * Falls back to legacy `reserve_lift_items.photo_urls` for items predating the dedicated table.
 */
export const listReserveLiftPhotos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ reserveId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: reserve } = await supabaseAdmin
      .from("pv_reserves")
      .select("id,company_id,pv_id,created_at")
      .eq("id", data.reserveId)
      .maybeSingle();
    if (!reserve?.company_id) throw new Error("Réserve introuvable.");

    const { data: member } = await supabaseAdmin
      .from("company_members")
      .select("id")
      .eq("company_id", reserve.company_id)
      .eq("user_id", context.userId)
      .eq("status", "active")
      .maybeSingle();
    if (!member) throw new Error("Accès refusé.");

    // Determine reserve order in its PV (1-based) for label fallback
    let reserveIndex = 1;
    if (reserve.pv_id) {
      const { data: siblings } = await supabaseAdmin
        .from("pv_reserves")
        .select("id,created_at")
        .eq("pv_id", reserve.pv_id)
        .order("created_at", { ascending: true });
      const found = (siblings ?? []).findIndex((r) => r.id === reserve.id);
      if (found >= 0) reserveIndex = found + 1;
    }
    const reserveNum = String(reserveIndex).padStart(3, "0");

    type Item = {
      id: string;
      photoType: "initial" | "before" | "after" | "legacy";
      url: string | null;
      label: string | null;
      fileName: string | null;
      latitude: number | null;
      longitude: number | null;
      accuracy: number | null;
      takenAt: string | null;
      uploadedAt: string | null;
      uploadedBy: string | null;
      deviceInfo: string | null;
    };
    const items: Item[] = [];

    // --- Initial constat photos from pv_photos.reserve_id ---
    const { data: initialRows } = await supabaseAdmin
      .from("pv_photos")
      .select("id,url,caption,created_at,latitude,longitude,accuracy,taken_at,uploaded_by,device_info,file_name,photo_label")
      .eq("reserve_id", data.reserveId)
      .order("created_at", { ascending: true });

    for (let idx = 0; idx < (initialRows ?? []).length; idx++) {
      const r = (initialRows as any[])[idx];
      const { data: signed } = await supabaseAdmin.storage.from("pv-assets").createSignedUrl(r.url, 3600);
      items.push({
        id: r.id,
        photoType: "initial",
        url: signed?.signedUrl ?? null,
        label: r.photo_label ?? `RES-${reserveNum}-CONST-${String(idx + 1).padStart(3, "0")}`,
        fileName: r.file_name ?? null,
        latitude: r.latitude,
        longitude: r.longitude,
        accuracy: r.accuracy,
        takenAt: r.taken_at,
        uploadedAt: r.created_at,
        uploadedBy: r.uploaded_by,
        deviceInfo: r.device_info,
      });
    }

    // --- Lift photos (before/after) from reserve_lift_item_photos ---
    const { data: rows } = await supabaseAdmin
      .from("reserve_lift_item_photos" as any)
      .select("id,photo_type,storage_path,latitude,longitude,accuracy,taken_at,uploaded_at,uploaded_by,device_info,file_name")
      .eq("reserve_id", data.reserveId)
      .order("uploaded_at", { ascending: true });

    let beforeIdx = 0; let afterIdx = 0;
    for (const r of (rows ?? []) as any[]) {
      const { data: signed } = await supabaseAdmin.storage.from("pv-assets").createSignedUrl(r.storage_path, 3600);
      const type = r.photo_type as "before" | "after" | "legacy";
      let label: string | null = null;
      if (type === "before") { beforeIdx += 1; label = `RES-${reserveNum}-AVANT-${String(beforeIdx).padStart(3, "0")}`; }
      else if (type === "after") { afterIdx += 1; label = `RES-${reserveNum}-APRES-${String(afterIdx).padStart(3, "0")}`; }
      items.push({
        id: r.id,
        photoType: type,
        url: signed?.signedUrl ?? null,
        label,
        fileName: r.file_name ?? null,
        latitude: r.latitude,
        longitude: r.longitude,
        accuracy: r.accuracy,
        takenAt: r.taken_at,
        uploadedAt: r.uploaded_at,
        uploadedBy: r.uploaded_by,
        deviceInfo: r.device_info,
      });
    }

    // Legacy fallback: only when no lift photos at all
    const hasLiftPhotos = items.some((i) => i.photoType === "before" || i.photoType === "after");
    if (!hasLiftPhotos) {
      const { data: legacyItems } = await supabaseAdmin
        .from("reserve_lift_items")
        .select("id,photo_urls")
        .eq("reserve_id", data.reserveId);
      for (const it of (legacyItems ?? []) as any[]) {
        for (const p of (it.photo_urls ?? []) as string[]) {
          const { data: signed } = await supabaseAdmin.storage.from("pv-assets").createSignedUrl(p, 3600);
          items.push({
            id: `${it.id}-${p}`,
            photoType: "legacy",
            url: signed?.signedUrl ?? null,
            label: null, fileName: null,
            latitude: null, longitude: null, accuracy: null,
            takenAt: null, uploadedAt: null, uploadedBy: null, deviceInfo: null,
          });
        }
      }
    }

    return { photos: items, reserveIndex };
  });

/**
 * Delete a single reserve-lift photo. Managers/owners only.
 * Cannot delete from a locked (signed) PV — trigger guards this.
 */
export const deleteReserveLiftPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ photoId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    const { data: photo } = await supabaseAdmin
      .from("reserve_lift_item_photos" as any)
      .select("id,company_id,pv_id,reserve_id,storage_path,photo_type")
      .eq("id", data.photoId)
      .maybeSingle();
    if (!photo) throw new Error("Photo introuvable.");

    const { data: member } = await supabaseAdmin
      .from("company_members")
      .select("role")
      .eq("company_id", (photo as any).company_id)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();
    if (!member || !(SIGN_ROLES as readonly string[]).includes(member.role as string)) {
      throw new Error("Accès refusé.");
    }

    await supabaseAdmin.storage.from("pv-assets").remove([(photo as any).storage_path]).catch(() => {});
    const { error: delErr } = await supabaseAdmin
      .from("reserve_lift_item_photos" as any)
      .delete()
      .eq("id", data.photoId);
    if (delErr) throw new Error(delErr.message);

    await writeAuditLog({
      companyId: (photo as any).company_id,
      userId,
      pvId: (photo as any).pv_id,
      entityType: "reserve_lift_photo",
      entityId: data.photoId,
      action: "reserve_lift_photo.deleted",
      metadata: { photo_type: (photo as any).photo_type, reserve_id: (photo as any).reserve_id },
      actor: "user",
    });

    return { ok: true as const };
  });

/**
 * Verify the on-disk file still matches the SHA-256 stored at upload time.
 * Result per photo: "valid" | "modified" | "missing" | "no_hash".
 * Company members only. Audited.
 */
export const verifyReserveLiftPhotoIntegrity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({
      reportId: z.string().uuid().optional(),
      photoId: z.string().uuid().optional(),
    }).refine((v) => v.reportId || v.photoId, "reportId ou photoId requis").parse(i),
  )
  .handler(async ({ data, context }) => {
    const userId = context.userId;

    let q = supabaseAdmin
      .from("reserve_lift_item_photos" as any)
      .select("id,company_id,pv_id,reserve_id,reserve_lift_item_id,storage_path,file_hash,file_name,photo_type");
    if (data.photoId) {
      q = q.eq("id", data.photoId);
    } else if (data.reportId) {
      const { data: items } = await supabaseAdmin
        .from("reserve_lift_items")
        .select("id")
        .eq("report_id", data.reportId);
      const ids = (items ?? []).map((i: any) => i.id);
      if (!ids.length) return { results: [] as Array<{ photoId: string; status: string }> };
      q = q.in("reserve_lift_item_id", ids);
    }
    const { data: rows } = await q;
    if (!rows?.length) return { results: [] as Array<{ photoId: string; status: string }> };

    // Auth: scope to caller's company.
    const companyId = (rows[0] as any).company_id;
    const { data: member } = await supabaseAdmin
      .from("company_members")
      .select("id")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();
    if (!member) throw new Error("Accès refusé.");

    const results: Array<{
      photoId: string; fileName: string | null; photoType: string;
      status: "valid" | "modified" | "missing" | "no_hash";
      storedHash: string | null; currentHash: string | null;
    }> = [];

    for (const r of rows as any[]) {
      if (r.company_id !== companyId) continue;
      if (!r.file_hash) {
        results.push({ photoId: r.id, fileName: r.file_name, photoType: r.photo_type, status: "no_hash", storedHash: null, currentHash: null });
        continue;
      }
      const { data: f, error: dErr } = await supabaseAdmin.storage.from("pv-assets").download(r.storage_path);
      if (dErr || !f) {
        results.push({ photoId: r.id, fileName: r.file_name, photoType: r.photo_type, status: "missing", storedHash: r.file_hash, currentHash: null });
        await writeAuditLog({
          companyId, userId, pvId: r.pv_id,
          entityType: "reserve_lift_photo", entityId: r.id,
          action: "reserve_lift_photo.integrity_failed",
          metadata: { reason: "missing", storage_path: r.storage_path },
          actor: "user",
        });
        continue;
      }
      const bytes = new Uint8Array(await f.arrayBuffer());
      const currentHash = await sha256OfBytes(bytes);
      const ok = currentHash === r.file_hash;
      results.push({
        photoId: r.id, fileName: r.file_name, photoType: r.photo_type,
        status: ok ? "valid" : "modified",
        storedHash: r.file_hash, currentHash,
      });
      await writeAuditLog({
        companyId, userId, pvId: r.pv_id,
        entityType: "reserve_lift_photo", entityId: r.id,
        action: ok ? "reserve_lift_photo.integrity_checked" : "reserve_lift_photo.integrity_failed",
        metadata: { stored_hash: r.file_hash, current_hash: currentHash, reason: ok ? null : "hash_mismatch" },
        actor: "user",
      });
    }

    return { results };
  });



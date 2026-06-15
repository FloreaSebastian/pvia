/**
 * Reserve-lift (levée de réserves) server functions.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { writeAuditLog } from "./audit.server";
import { firePushToCompany } from "./push.server";
import { buildAndStoreReserveLiftPdf } from "./reserve-lift.server";
import { deliverSignedReserveLift } from "./reserve-lift-email.server";
import { sendReserveLiftValidationRequestEmail } from "./reserve-lift-validation-email.server";
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
});

const ItemSchema = z.object({
  reserveId: z.string().uuid(),
  comment: z.string().max(2000).optional().default(""),
  photos: z.array(PhotoSchema).max(PHOTO_MAX_COUNT).optional().default([]),
});

const InputSchema = z.object({
  pvId: z.string().uuid(),
  status: z.enum(["brouillon", "signe"]),
  comment: z.string().max(5000).optional().default(""),
  requireClientSignature: z.boolean().optional().default(false),
  items: z.array(ItemSchema).min(1).max(50),
  companySignature: z.string().max(800_000).nullable().optional(),
  clientSignature: z.string().max(800_000).nullable().optional(),
});

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
    if (!member || !["owner", "admin", "manager"].includes(member.role)) {
      throw new Error("Accès refusé : seul un manager peut créer une levée de réserves.");
    }

    // Suspension / billing gate.
    const { assertSubscriptionUsable } = await import("./plan-guard.server");
    await assertSubscriptionUsable(pv.company_id, userId);

    // 2. Validate signatures
    if (data.status === "signe") {
      if (!data.companySignature) throw new Error("Signature entreprise obligatoire.");
      if (data.requireClientSignature && !data.clientSignature) {
        throw new Error("Signature client obligatoire selon vos paramètres.");
      }
    }
    const companySig = validateSignature(data.companySignature);
    const clientSig = validateSignature(data.clientSignature);

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
          company_signature: companySig,
          client_signature: clientSig,
          require_client_signature: data.requireClientSignature,
          signed_at: data.status === "signe" ? nowIso : null,
          created_by: userId,
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

    // 6. Validate + upload item photos, insert items
    for (const item of data.items) {
      const photoPaths: string[] = [];
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
        const path = `${pv.company_id}/lifts/${reportId}/${item.reserveId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error: upErr } = await supabaseAdmin.storage
          .from("pv-assets")
          .upload(path, bytes, { contentType: normMime(sniffed), upsert: false });
        if (upErr) {
          console.error("reserve-lift: photo upload failed", upErr);
          continue;
        }
        photoPaths.push(path);
        void safeFilename(p.fileName);
      }

      const reserve = reserveById.get(item.reserveId)!;
      await supabaseAdmin.from("reserve_lift_items").insert({
        report_id: reportId,
        reserve_id: item.reserveId,
        old_status: reserve.status,
        new_status: "levee",
        comment: item.comment || null,
        photo_urls: photoPaths,
      } as any);
    }

    // 7. Update each reserve to status=levee
    if (reserveIds.length) {
      await supabaseAdmin.from("pv_reserves").update({ status: "levee" }).in("id", reserveIds);
    }

    // 8. Generate PDF if signed
    let pdfPath: string | null = null;
    if (data.status === "signe") {
      try {
        pdfPath = await buildAndStoreReserveLiftPdf(reportId);
      } catch (e) {
        console.error("reserve-lift: PDF failed", e);
    }

    // EM-C1: when company signs the lift, ask the client to validate.
    if (data.status === "signe") {
      try {
        await sendReserveLiftValidationRequestEmail({ reportId });
      } catch (e) {
        console.error("reserve-lift: validation email failed", e);
      }
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
      .select("id,numero,status,signed_at,pdf_url,created_at,client_validated_at,client_validated_email")
      .eq("pv_id", data.pvId)
      .order("created_at", { ascending: false });
    return { lifts: rows ?? [] };
  });

export const getReserveLiftPdfUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ reportId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: r } = await supabaseAdmin
      .from("reserve_lift_reports")
      .select("company_id,pdf_url")
      .eq("id", data.reportId)
      .maybeSingle();
    if (!r?.pdf_url) throw new Error("PDF indisponible.");
    const { data: m } = await supabaseAdmin
      .from("company_members")
      .select("id")
      .eq("company_id", r.company_id)
      .eq("user_id", context.userId)
      .eq("status", "active")
      .maybeSingle();
    if (!m) throw new Error("Accès refusé.");
    const { data: signed } = await supabaseAdmin.storage.from("pv-assets").createSignedUrl(r.pdf_url, 3600);
    if (!signed?.signedUrl) throw new Error("Lien indisponible.");
    return { url: signed.signedUrl };
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
    if (!member || !["owner", "admin", "manager"].includes(member.role)) {
      throw new Error("Accès refusé.");
    }

    // Ensure PDF exists (regenerate if missing)
    if (!report.pdf_url) {
      try {
        await buildAndStoreReserveLiftPdf(report.id);
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
    if (!member || !["owner", "admin", "manager"].includes(member.role)) {
      throw new Error("Accès refusé.");
    }

    const res = await sendReserveLiftValidationRequestEmail({ reportId: report.id });
    if (!res.ok) throw new Error(res.error || "Envoi échoué.");
    return { ok: true as const, recipient: res.recipient };
  });

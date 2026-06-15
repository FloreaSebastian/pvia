/**
 * Client-area server functions for "levée de réserves" validation.
 * Strictly scoped to the authenticated client session — the client can only
 * see and validate lifts attached to a PV that belongs to them.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { writeAuditLog } from "@/lib/audit.server";
import { enforceRateLimit } from "@/lib/rate-limit.server";
import { decodeAndValidateImage } from "@/lib/image-validate.server";
import { firePushToCompany } from "@/lib/push.server";
import { buildAndStoreReserveLiftPdf } from "@/lib/reserve-lift.server";
import { dispatchWebhookEvent } from "@/lib/webhooks.server";
import { deliverSignedReserveLift } from "@/lib/reserve-lift-email.server";
import {
  getClientIp,
  getClientUA,
  normalizeEmail,
  readClientCookieToken,
  sha256Hex,
} from "@/lib/client-auth.server";

/* ─── session helpers (mirrors client-auth.functions) ─────────────────── */

type ClientSession = {
  sessionId: string;
  clientId: string | null;
  email: string;
};

async function requireSession(): Promise<ClientSession> {
  const token = readClientCookieToken();
  if (!token) throw new Error("Session expirée. Reconnectez-vous.");
  const tokenHash = await sha256Hex(token);
  const { data } = await supabaseAdmin
    .from("client_sessions")
    .select("id,client_id,email,expires_at,revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (!data || data.revoked_at) throw new Error("Session expirée. Reconnectez-vous.");
  if (new Date(data.expires_at).getTime() <= Date.now())
    throw new Error("Session expirée. Reconnectez-vous.");
  return { sessionId: data.id, clientId: data.client_id, email: normalizeEmail(data.email) };
}

async function fetchPvForClient(pvId: string, s: ClientSession) {
  const { data: pv } = await supabaseAdmin
    .from("pv")
    .select("id,numero,company_id,client_id,chantier_id,sent_to_email,reserve_lift_status")
    .eq("id", pvId)
    .maybeSingle();
  if (!pv) throw new Error("PV introuvable.");
  const owned =
    (s.clientId && pv.client_id === s.clientId) ||
    (pv.sent_to_email && pv.sent_to_email.toLowerCase() === s.email);
  if (!owned) throw new Error("Accès refusé.");
  return pv;
}

/* ─── list lifts for one PV ────────────────────────────────────────────── */

export const listClientReserveLifts = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ pvId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const s = await requireSession();
    await fetchPvForClient(data.pvId, s);
    const { data: rows } = await supabaseAdmin
      .from("reserve_lift_reports")
      .select("id,numero,status,signed_at,client_validated_at,pdf_url,created_at,comment")
      .eq("pv_id", data.pvId)
      .in("status", ["signe", "signed_by_company", "client_validated"])
      .order("created_at", { ascending: false });

    // attach item counts
    const ids = (rows ?? []).map((r: any) => r.id);
    let countMap = new Map<string, number>();
    if (ids.length) {
      const { data: items } = await supabaseAdmin
        .from("reserve_lift_items")
        .select("report_id")
        .in("report_id", ids);
      for (const i of items ?? []) {
        const k = (i as any).report_id as string;
        countMap.set(k, (countMap.get(k) ?? 0) + 1);
      }
    }
    return {
      lifts: (rows ?? []).map((r: any) => ({
        ...r,
        items_count: countMap.get(r.id) ?? 0,
      })),
    };
  });

/* ─── detail of one lift ───────────────────────────────────────────────── */

export const getClientReserveLiftDetail = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z.object({ pvId: z.string().uuid(), liftId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const s = await requireSession();
    const pv = await fetchPvForClient(data.pvId, s);

    const { data: report } = await supabaseAdmin
      .from("reserve_lift_reports")
      .select(
        "id,numero,status,comment,company_signature,client_signature,signed_at,pdf_url,pv_id,company_id,created_at,client_validated_at,client_validated_email",
      )
      .eq("id", data.liftId)
      .eq("pv_id", pv.id)
      .maybeSingle();
    if (!report) throw new Error("Levée introuvable.");

    const { data: items } = await supabaseAdmin
      .from("reserve_lift_items")
      .select("id,reserve_id,old_status,new_status,comment,photo_urls")
      .eq("report_id", report.id);

    const reserveIds = (items ?? []).map((i: any) => i.reserve_id);
    const { data: reserves } = reserveIds.length
      ? await supabaseAdmin
          .from("pv_reserves")
          .select("id,description,nature,work_to_execute,severity,status")
          .in("id", reserveIds)
      : { data: [] as any[] };
    const reserveMap = new Map((reserves ?? []).map((r: any) => [r.id, r]));

    // sign photo URLs
    const enriched = await Promise.all(
      (items ?? []).map(async (it: any) => {
        const photos = await Promise.all(
          (it.photo_urls ?? []).map(async (p: string) => {
            const { data: u } = await supabaseAdmin.storage
              .from("pv-assets")
              .createSignedUrl(p, 3600);
            return u?.signedUrl ?? null;
          }),
        );
        return {
          id: it.id,
          reserve_id: it.reserve_id,
          comment: it.comment,
          reserve: reserveMap.get(it.reserve_id) ?? null,
          photos: photos.filter(Boolean) as string[],
        };
      }),
    );

    const [{ data: company }, { data: chantier }] = await Promise.all([
      pv.company_id
        ? supabaseAdmin
            .from("companies")
            .select("name,logo_url,email")
            .eq("id", pv.company_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      pv.chantier_id
        ? supabaseAdmin
            .from("chantiers")
            .select("name,address")
            .eq("id", pv.chantier_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    return {
      pv: { id: pv.id, numero: pv.numero, reserve_lift_status: pv.reserve_lift_status },
      report,
      items: enriched,
      company,
      chantier,
    };
  });

/* ─── signed PDF URL for client ─────────────────────────────────────────── */

export const getClientReserveLiftPdfUrl = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z.object({ pvId: z.string().uuid(), liftId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const s = await requireSession();
    const pv = await fetchPvForClient(data.pvId, s);
    const { data: r } = await supabaseAdmin
      .from("reserve_lift_reports")
      .select("pdf_url")
      .eq("id", data.liftId)
      .eq("pv_id", pv.id)
      .maybeSingle();
    if (!r?.pdf_url) throw new Error("PDF indisponible.");
    const { data: signed } = await supabaseAdmin.storage
      .from("pv-assets")
      .createSignedUrl(r.pdf_url, 3600);
    if (!signed?.signedUrl) throw new Error("Lien indisponible.");
    return { url: signed.signedUrl };
  });

/* ─── client validation ─────────────────────────────────────────────────── */

const ValidateSchema = z.object({
  pvId: z.string().uuid(),
  liftId: z.string().uuid(),
  signatureDataUrl: z.string().startsWith("data:image/").max(2_000_000),
  consent: z.literal(true),
});

export const validateReserveLiftAsClient = createServerFn({ method: "POST" })
  .inputValidator((d) => ValidateSchema.parse(d))
  .handler(async ({ data }) => {
    const s = await requireSession();
    const ip = getClientIp() ?? "unknown";
    const ua = getClientUA();

    await enforceRateLimit({
      bucket: "client_validate_lift",
      key: `${s.email}:${data.liftId}`,
      limit: 5,
      windowSec: 600,
    });
    decodeAndValidateImage(data.signatureDataUrl, { maxBytes: 2_000_000 });

    const pv = await fetchPvForClient(data.pvId, s);

    // Load report and verify ownership chain
    const { data: report } = await supabaseAdmin
      .from("reserve_lift_reports")
      .select("id,status,company_signature,client_validated_at,company_id,numero,pv_id")
      .eq("id", data.liftId)
      .eq("pv_id", pv.id)
      .maybeSingle();
    if (!report) throw new Error("Levée introuvable.");
    if (report.client_validated_at) throw new Error("Cette levée est déjà validée.");
    if (!report.company_signature) {
      throw new Error("L'entreprise doit signer la levée avant validation.");
    }
    if (!["signe", "signed_by_company"].includes(report.status as string)) {
      throw new Error("Cette levée n'est pas en attente de validation.");
    }

    const nowIso = new Date().toISOString();
    // WF-M7: atomic guard against double validation (TOCTOU). Only one
    // request can flip `client_validated_at` from null → now().
    const { data: claimed, error: upErr } = await supabaseAdmin
      .from("reserve_lift_reports")
      .update({
        client_signature: data.signatureDataUrl,
        client_validated_at: nowIso,
        client_validated_email: s.email,
        client_validated_ip: ip,
        status: "client_validated",
      } as any)
      .eq("id", report.id)
      .is("client_validated_at", null)
      .select("id");
    if (upErr) throw new Error(upErr.message);
    if (!claimed || claimed.length === 0) {
      try {
        await writeAuditLog({
          companyId: report.company_id,
          pvId: pv.id,
          entityType: "reserve_lift",
          entityId: report.id,
          action: "reserve_lift.client_double_validation_blocked",
          metadata: { email: s.email },
          actor: "client",
        });
      } catch {}
      throw new Error("Cette levée est déjà validée.");
    }

    // Flip every reserve attached to this lift to "validee"
    const { data: items } = await supabaseAdmin
      .from("reserve_lift_items")
      .select("reserve_id")
      .eq("report_id", report.id);
    const reserveIds = (items ?? []).map((i: any) => i.reserve_id);
    if (reserveIds.length) {
      const { error: rUpErr } = await supabaseAdmin
        .from("pv_reserves")
        .update({ status: "validee", validated_at: nowIso } as any)
        .in("id", reserveIds);
      if (rUpErr) {
        const { recordProcessingError } = await import("@/lib/processing-status.server");
        await recordProcessingError({
          table: "reserve_lift_reports", id: report.id, companyId: report.company_id, pvId: pv.id,
          step: "client_update_reserves_status",
          error: rUpErr,
          meta: { reserve_ids: reserveIds },
          audit: { action: "reserve_lift.reserves_update_failed", entityType: "reserve_lift" },
        });
      }
    }

    // Regenerate PDF with client signature — capture failure into status.
    let pdfPath: string | null = null;
    {
      const { markPdfGenerationStatus, recordProcessingError } = await import("@/lib/processing-status.server");
      await markPdfGenerationStatus("reserve_lift_reports", report.id, "pending");
      try {
        pdfPath = await buildAndStoreReserveLiftPdf(report.id);
        await markPdfGenerationStatus("reserve_lift_reports", report.id, "ok");
      } catch (e) {
        await markPdfGenerationStatus("reserve_lift_reports", report.id, "failed");
        await recordProcessingError({
          table: "reserve_lift_reports", id: report.id, companyId: report.company_id, pvId: pv.id,
          step: "build_lift_pdf_after_validation",
          error: e,
          audit: { action: "reserve_lift.pdf_generation_failed", entityType: "reserve_lift" },
        });
      }
    }

    // Email + notify — capture failure into status.
    let emailSent = false;
    try {
      await deliverSignedReserveLift({ reportId: report.id });
      emailSent = true;
    } catch (e) {
      const { recordProcessingError } = await import("@/lib/processing-status.server");
      await recordProcessingError({
        table: "reserve_lift_reports", id: report.id, companyId: report.company_id, pvId: pv.id,
        step: "send_client_validated_email",
        error: e,
        audit: { action: "reserve_lift.client_validated_email_failed", entityType: "reserve_lift" },
      });
    }

    // Push to company
    if (report.company_id) {
      try {
        firePushToCompany(report.company_id, {
          title: "Levée de réserves validée",
          body: `${report.numero} validée par ${s.email}`,
          url: `/pv/${pv.id}`,
          tag: `lift-validated-${report.id}`,
          requireInteraction: true,
          data: { kind: "reserve_lift.client_validated", reportId: report.id, pvId: pv.id },
        });
        await supabaseAdmin.from("notifications").insert({
          company_id: report.company_id,
          type: "reserve_lift_validated",
          title: "Levée de réserves validée par le client",
          body: `${report.numero} pour le PV ${pv.numero} a été validée par ${s.email}.`,
        });
      } catch (e) {
        console.error("push/notif failed:", e);
      }
    }

    // Audit
    await writeAuditLog({
      companyId: report.company_id,
      pvId: pv.id,
      entityType: "reserve_lift",
      entityId: report.id,
      action: "reserve_lift.client_validated",
      newValues: { status: "client_validated", validated_at: nowIso },
      metadata: { actor_email: s.email, ip, ua, numero: report.numero, items: reserveIds.length },
      actor: "client",
    });
    if (emailSent) {
      await writeAuditLog({
        companyId: report.company_id,
        pvId: pv.id,
        entityType: "reserve_lift",
        entityId: report.id,
        action: "reserve_lift.client_validated_email_sent",
        metadata: { numero: report.numero, recipient: s.email },
        actor: "email",
      });
    }
    for (const rid of reserveIds) {
      await writeAuditLog({
        companyId: report.company_id,
        pvId: pv.id,
        entityType: "reserve",
        entityId: rid,
        action: "reserve.validated_by_client",
        metadata: { actor_email: s.email, report_id: report.id },
        actor: "client",
      });
    }

    // Webhook (best-effort)
    if (report.company_id) {
      void dispatchWebhookEvent(report.company_id, "reserve_lift.client_validated", {
        report: { id: report.id, numero: report.numero, status: "client_validated", validated_at: nowIso },
        pv: { id: pv.id, numero: pv.numero },
        validated_by: { email: s.email },
      });
    }

    return { ok: true as const, pdfPath };
  });

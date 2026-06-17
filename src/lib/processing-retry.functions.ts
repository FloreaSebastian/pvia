import { createServerFn } from "@tanstack/react-start";
import { ADMIN_ROLES, OWNER_ROLES, SIGN_ROLES, isAdminRole, isManageRole } from "@/lib/roles";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { writeAuditLog } from "@/lib/audit.server";

async function assertMember(companyId: string, userId: string) {
  const { data: m } = await supabaseAdmin
    .from("company_members")
    .select("role,status")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (!m || !(SIGN_ROLES as readonly string[]).includes((m as any).role)) {
    throw new Error("Accès refusé.");
  }
}

/** Phase 2 — Retry PV PDF generation. Owner/admin/manager only. */
export const retryPvPdfGeneration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ pvId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: pv } = await supabaseAdmin
      .from("pv")
      .select("id,company_id,status")
      .eq("id", data.pvId)
      .maybeSingle();
    if (!pv?.company_id) throw new Error("PV introuvable.");
    if (pv.status !== "signe") throw new Error("Le PV doit être signé.");
    await assertMember(pv.company_id, context.userId);

    const { markPdfGenerationStatus, recordProcessingError } = await import("@/lib/processing-status.server");
    const { buildAndStorePvPdf } = await import("@/lib/pdf.server");
    await markPdfGenerationStatus("pv", pv.id, "pending");
    try {
      const path = await buildAndStorePvPdf(pv.id);
      await markPdfGenerationStatus("pv", pv.id, "ok");
      await writeAuditLog({
        companyId: pv.company_id, userId: context.userId, pvId: pv.id,
        entityType: "pv", entityId: pv.id,
        action: "pv.pdf_regenerated",
        metadata: { path, trigger: "manual_retry" },
        actor: "user",
      });
      return { ok: true as const, path };
    } catch (e) {
      await markPdfGenerationStatus("pv", pv.id, "failed");
      await recordProcessingError({
        table: "pv", id: pv.id, companyId: pv.company_id, pvId: pv.id, userId: context.userId,
        step: "manual_retry_pdf",
        error: e,
        audit: { action: "pv.pdf_generation_failed", entityType: "pv" },
      });
      throw e;
    }
  });

/** Phase 2 — Retry reserve-lift PDF generation. */
export const retryReserveLiftPdfGeneration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ reportId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: report } = await supabaseAdmin
      .from("reserve_lift_reports")
      .select("id,company_id,pv_id")
      .eq("id", data.reportId)
      .maybeSingle();
    if (!report?.company_id) throw new Error("Levée introuvable.");
    await assertMember(report.company_id, context.userId);

    const { markPdfGenerationStatus, recordProcessingError } = await import("@/lib/processing-status.server");
    const { buildAndStoreReserveLiftPdfs } = await import("@/lib/reserve-lift.server");
    await markPdfGenerationStatus("reserve_lift_reports", report.id, "pending");
    try {
      const { clientPath: path } = await buildAndStoreReserveLiftPdfs(report.id);
      await markPdfGenerationStatus("reserve_lift_reports", report.id, "ok");
      await writeAuditLog({
        companyId: report.company_id, userId: context.userId, pvId: report.pv_id,
        entityType: "reserve_lift", entityId: report.id,
        action: "reserve_lift.pdf_regenerated",
        metadata: { path, trigger: "manual_retry" },
        actor: "user",
      });
      return { ok: true as const, path };
    } catch (e) {
      await markPdfGenerationStatus("reserve_lift_reports", report.id, "failed");
      await recordProcessingError({
        table: "reserve_lift_reports", id: report.id, companyId: report.company_id, pvId: report.pv_id,
        step: "manual_retry_pdf",
        error: e,
        audit: { action: "reserve_lift.pdf_generation_failed", entityType: "reserve_lift" },
      });
      throw e;
    }
  });

/** Phase 2 — List PVs and lifts with processing failures, for platform admin monitoring. */
export const listProcessingFailures = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await supabaseAdmin.rpc("is_platform_admin", { _user_id: context.userId });
    if (!isAdmin) throw new Error("Accès refusé.");

    const { data: pvs } = await supabaseAdmin
      .from("pv")
      .select("id,numero,company_id,status,processing_status,pdf_generation_status,photos_failed_count,processing_errors,created_at")
      .neq("processing_status", "ok")
      .order("created_at", { ascending: false })
      .limit(100);

    const { data: lifts } = await supabaseAdmin
      .from("reserve_lift_reports")
      .select("id,numero,company_id,pv_id,status,processing_status,pdf_generation_status,processing_errors,created_at")
      .neq("processing_status", "ok")
      .order("created_at", { ascending: false })
      .limit(100);

    return { pvs: pvs ?? [], lifts: lifts ?? [] };
  });

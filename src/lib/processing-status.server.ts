/**
 * Phase 2 — Workflow PV error visibility.
 *
 * Centralized helper to record a non-fatal processing error against a PV
 * or reserve-lift row. Every call:
 *   - flips `processing_status` to 'partial_error' (unless already 'failed')
 *   - appends a structured entry to `processing_errors` (jsonb array)
 *   - optionally writes an audit_log row with a known action
 *
 * Designed to replace bare `console.error` calls in createPv / createReserveLift.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { writeAuditLog } from "@/lib/audit.server";

type Table = "pv" | "reserve_lift_reports";

export interface ProcessingErrorEntry {
  step: string;
  message: string;
  at: string;
  meta?: Record<string, unknown>;
}

export async function recordProcessingError(opts: {
  table: Table;
  id: string;
  companyId: string;
  pvId?: string | null;
  userId?: string | null;
  step: string;
  error: unknown;
  meta?: Record<string, unknown>;
  audit?: {
    action: string;
    entityType?: string;
  };
  fatal?: boolean; // if true, sets processing_status='failed'
}): Promise<void> {
  const message = errMsg(opts.error);
  const entry: ProcessingErrorEntry = {
    step: opts.step,
    message,
    at: new Date().toISOString(),
    meta: opts.meta,
  };

  try {
    const { data: current } = await supabaseAdmin
      .from(opts.table)
      .select("processing_errors,processing_status")
      .eq("id", opts.id)
      .maybeSingle();
    const prev = Array.isArray((current as any)?.processing_errors)
      ? ((current as any).processing_errors as ProcessingErrorEntry[])
      : [];
    const prevStatus = (current as any)?.processing_status ?? "ok";
    const nextStatus = opts.fatal
      ? "failed"
      : prevStatus === "failed"
        ? "failed"
        : "partial_error";
    await supabaseAdmin
      .from(opts.table)
      .update({
        processing_errors: [...prev, entry],
        processing_status: nextStatus,
      } as any)
      .eq("id", opts.id);
  } catch (e) {
    // Never let bookkeeping errors break the calling flow — but log loudly.
    console.error("[processing-status] update failed", e);
  }

  if (opts.audit) {
    try {
      await writeAuditLog({
        companyId: opts.companyId,
        userId: opts.userId ?? undefined,
        pvId: opts.pvId ?? undefined,
        entityType: opts.audit.entityType ?? opts.table,
        entityId: opts.id,
        action: opts.audit.action,
        metadata: { step: opts.step, error: message, ...(opts.meta ?? {}) },
        actor: "system",
      });
    } catch (e) {
      console.error("[processing-status] audit failed", e);
    }
  }
}

export async function markPdfGenerationStatus(
  table: Table,
  id: string,
  status: "pending" | "ok" | "failed",
): Promise<void> {
  try {
    await supabaseAdmin
      .from(table)
      .update({ pdf_generation_status: status } as any)
      .eq("id", id);
  } catch (e) {
    console.error("[processing-status] pdf status update failed", e);
  }
}

export async function bumpPhotosFailed(pvId: string, by = 1): Promise<void> {
  try {
    const { data } = await supabaseAdmin
      .from("pv")
      .select("photos_failed_count")
      .eq("id", pvId)
      .maybeSingle();
    const prev = ((data as any)?.photos_failed_count ?? 0) as number;
    await supabaseAdmin
      .from("pv")
      .update({ photos_failed_count: prev + by } as any)
      .eq("id", pvId);
  } catch (e) {
    console.error("[processing-status] photos_failed_count bump failed", e);
  }
}

function errMsg(e: unknown): string {
  if (!e) return "unknown";
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  if (typeof e === "object" && e && "message" in e) {
    return String((e as { message?: unknown }).message ?? "unknown");
  }
  return String(e);
}

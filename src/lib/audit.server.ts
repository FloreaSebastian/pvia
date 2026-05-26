import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getRequest, getRequestHeader } from "@tanstack/react-start/server";

export type AuditAction =
  | "pv.create"
  | "pv.update"
  | "pv.updated"
  | "pv.delete"
  | "pv.status_change"
  | "pv.sent_to_client"
  | "pv.signed_by_client"
  | "pv.signed_by_company"
  | "pv.pdf_generated"
  | "pv.pdf_downloaded"
  | "pv.email_sent"
  | "pv.email_failed"
  | "reserve.create"
  | "reserve.update"
  | "reserve.delete"
  | "reserve.lifted"
  | "reserve.validated"
  | "reserve.status_lifted"
  | "reserve_lift.created"
  | "reserve_lift.signed"
  | "pv.has_open_reserves"
  | "pv.all_reserves_lifted"
  | "push.sent"
  | "photo.add"
  | "photo.delete"
  | "member.invited"
  | "member.joined"
  | "member.role_changed"
  | "member.suspended"
  | "member.reactivated"
  | "member.removed"
  | "audit.exported"
  | "client.login_code_sent"
  | "client.login_code_ignored_unknown_email"
  | "client.login_code_rate_limited"
  | "client.login_success"
  | "client.login_failed"
  | "client.logout"
  | "client.pv_viewed"
  | "client.pdf_downloaded"
  | "client.pv_signed"
  | "client.session_revoked"
  | "client.all_sessions_revoked"
  | "user.login_code_sent"
  | "user.login_success"
  | "user.login_failed"
  | "user.logout"
  | "onboarding.started"
  | "onboarding.profile_completed"
  | "onboarding.company_lookup"
  | "onboarding.company_completed"
  | "onboarding.completed"
  | "company.updated_from_siren"
  | "company.branding_updated"
  | "company.logo_updated"
  | "company.legal_info_updated"
  | "settings.saved"
  | "settings.autosaved"
  | "settings.reset"
  | "settings.search_used"
  | "branding.published"
  | "branding.rollback";


export type AuditActor = "system" | "user" | "client" | "email" | "pdf" | "signature" | "push" | "cron";

export type WriteAuditLogInput = {
  companyId: string | null;
  userId?: string | null;
  pvId?: string | null;
  entityType: string;
  entityId?: string | null;
  action: AuditAction | string;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  actor?: AuditActor;
};

/** Best-effort client IP from the incoming request. */
function getClientIp(): string | null {
  try {
    const xff = getRequestHeader("x-forwarded-for");
    if (xff) return xff.split(",")[0]?.trim() || null;
    const real = getRequestHeader("x-real-ip");
    if (real) return real;
    const cf = getRequestHeader("cf-connecting-ip");
    if (cf) return cf;
  } catch {
    // not in a request context (e.g. background)
  }
  return null;
}

function getUA(): string | null {
  try {
    return getRequestHeader("user-agent") || null;
  } catch {
    return null;
  }
}

/**
 * Append-only audit log writer. Never throws — logging failures must not block business logic.
 * Uses supabaseAdmin so it bypasses RLS (table has no write policies, by design).
 */
export async function writeAuditLog(input: WriteAuditLogInput): Promise<void> {
  try {
    const meta = { ...(input.metadata ?? {}), actor: input.actor ?? "user" };
    await supabaseAdmin.from("audit_logs").insert({
      company_id: input.companyId,
      user_id: input.userId ?? null,
      pv_id: input.pvId ?? null,
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      action: input.action,
      old_values: (input.oldValues ?? null) as any,
      new_values: (input.newValues ?? null) as any,
      ip_address: getClientIp(),
      user_agent: getUA(),
      metadata: meta,
    });
  } catch (e) {
    console.error("writeAuditLog failed:", e);
  }
}

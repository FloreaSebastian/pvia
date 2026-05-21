import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type ErrorSeverity = "info" | "warning" | "error" | "critical";

export interface CaptureErrorInput {
  source: string;            // e.g. "serverFn:signPvByToken", "push.fanout", "email.send"
  error: unknown;
  severity?: ErrorSeverity;
  context?: Record<string, unknown>;
  userId?: string | null;
  companyId?: string | null;
}

/**
 * Insère une erreur dans `public.app_errors`. Ne JAMAIS throw (sinon on
 * casse le flux d'erreur principal). Best-effort, log console en fallback.
 */
export async function captureError(input: CaptureErrorInput): Promise<void> {
  const e = input.error;
  const message = e instanceof Error ? e.message : String(e ?? "Unknown error");
  const stack = e instanceof Error ? e.stack ?? null : null;
  try {
    await supabaseAdmin.from("app_errors").insert({
      source: input.source,
      severity: input.severity ?? "error",
      message: message.slice(0, 2000),
      stack: stack ? stack.slice(0, 8000) : null,
      context: (input.context ?? null) as never,
      user_id: input.userId ?? null,
      company_id: input.companyId ?? null,
    });
  } catch (insertErr) {
    console.error("[captureError] failed to persist:", insertErr, "original:", e);
  }
}

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { writeAuditLog } from "./audit.server";

/**
 * Lightweight client-callable audit logger for settings UX events
 * (autosave, manual save, reset, search). Server-side membership
 * check ensures users can only log against companies they belong to.
 *
 * We deliberately scrub overly verbose payloads — fields are limited
 * to a short section name + a redacted list of changed keys.
 */
const Schema = z.object({
  companyId: z.string().uuid().nullable().optional(),
  action: z.enum(["settings.saved", "settings.autosaved", "settings.reset", "settings.search_used"]),
  section: z.string().min(1).max(80),
  changedFields: z.array(z.string().min(1).max(80)).max(40).optional(),
  oldValues: z.record(z.string(), z.unknown()).optional(),
  newValues: z.record(z.string(), z.unknown()).optional(),
  query: z.string().max(120).optional(),
});

const SENSITIVE_KEYS = new Set(["password", "token", "secret", "api_key", "key_hash", "signature"]);

function scrub(obj: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!obj) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) continue;
    if (typeof v === "string" && v.length > 500) out[k] = v.slice(0, 500) + "…";
    else out[k] = v;
  }
  return out;
}

export const logSettingsEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => Schema.parse(i))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    if (data.companyId) {
      const { data: m } = await supabaseAdmin
        .from("company_members")
        .select("id")
        .eq("company_id", data.companyId)
        .eq("user_id", userId)
        .eq("status", "active")
        .maybeSingle();
      if (!m) return { ok: false };
    }
    await writeAuditLog({
      companyId: data.companyId ?? null,
      userId,
      entityType: "settings",
      action: data.action,
      oldValues: scrub(data.oldValues),
      newValues: scrub(data.newValues),
      metadata: {
        section: data.section,
        changed_fields: data.changedFields ?? null,
        query: data.action === "settings.search_used" ? (data.query ?? null) : null,
      },
      actor: "user",
    });
    return { ok: true };
  });

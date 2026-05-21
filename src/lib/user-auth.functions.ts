import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const EventSchema = z.object({
  action: z.enum(["user.login_code_sent", "user.login_success", "user.login_failed", "user.logout"]),
  email: z.string().email().max(254).optional(),
  metadata: z.record(z.string().min(1).max(64), z.unknown()).optional(),
});

/**
 * Best-effort audit logger for passwordless user auth events.
 * Never throws to the caller — auth UX must not depend on logging.
 */
export const logUserAuthEvent = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => EventSchema.parse(d))
  .handler(async ({ data }) => {
    try {
      let userId: string | null = null;
      let companyId: string | null = null;
      if (data.email) {
        const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1 });
        const match = list?.users.find((u) => (u.email ?? "").toLowerCase() === data.email!.toLowerCase());
        if (match) {
          userId = match.id;
          const { data: cm } = await supabaseAdmin
            .from("company_members")
            .select("company_id")
            .eq("user_id", match.id)
            .eq("status", "active")
            .limit(1)
            .maybeSingle();
          companyId = cm?.company_id ?? null;
        }
      }
      await writeAuditLog({
        companyId,
        userId,
        entityType: "auth",
        entityId: userId,
        action: data.action,
        metadata: { email: data.email, ...(data.metadata ?? {}) },
      });
    } catch {
      // swallow
    }
    return { ok: true };
  });

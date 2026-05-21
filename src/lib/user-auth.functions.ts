import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit.server";
import { enforceRateLimit, getClientIp } from "@/lib/rate-limit.server";

const EventSchema = z.object({
  action: z.enum(["user.login_code_sent", "user.login_success", "user.login_failed", "user.logout"]),
  email: z.string().email().max(254).optional(),
  metadata: z.record(z.string().min(1).max(64), z.unknown()).optional(),
});

/**
 * Best-effort audit logger for passwordless user auth events.
 * Never throws to the caller — auth UX must not depend on logging.
 * Rate-limited per IP to prevent audit-log spam.
 */
export const logUserAuthEvent = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => EventSchema.parse(d))
  .handler(async ({ data }) => {
    try {
      const ip = getClientIp(getRequest());
      await enforceRateLimit({
        bucket: "auth.log",
        key: ip,
        limit: 20,
        windowSec: 60,
      });
    } catch (e) {
      if ((e as any)?.name === "RateLimitError") {
        // Silently drop — auth UX must not surface logger throttling.
        return { ok: true };
      }
    }
    try {
      // Note: we intentionally do NOT look up the user id via admin.listUsers
      // here — that's a privileged call and would be expensive to spam.
      // The email is recorded in metadata; correlation happens at query time.
      await writeAuditLog({
        companyId: null,
        userId: null,
        entityType: "auth",
        entityId: null,
        action: data.action,
        metadata: { email: data.email, ...(data.metadata ?? {}) },
      });
    } catch {
      // swallow
    }
    return { ok: true };
  });

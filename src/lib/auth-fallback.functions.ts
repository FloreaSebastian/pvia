/**
 * Server helpers for the post-OTP fallback login flow (password + SMS).
 * Main login remains the 6-digit email code; this is the secondary path.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { enforceRateLimit } from "@/lib/rate-limit.server";
import { getClientIp, normalizeEmail } from "@/lib/client-auth.server";

const EmailSchema = z.object({ email: z.string().email().max(255) });

/**
 * Per-email + per-IP rate limit before any password attempt.
 * Called from the client BEFORE supabase.auth.signInWithPassword so we never
 * lean on the Supabase rate limiter alone and never reveal whether the email
 * exists.
 */
export const assertPasswordFallbackAllowed = createServerFn({ method: "POST" })
  .inputValidator((d) => EmailSchema.parse(d))
  .handler(async ({ data }) => {
    const email = normalizeEmail(data.email);
    const ip = getClientIp() ?? "unknown";
    await enforceRateLimit({
      bucket: "enterprise_password_fallback_email",
      key: email,
      limit: 5,
      windowSec: 900,
    });
    await enforceRateLimit({
      bucket: "enterprise_password_fallback_ip",
      key: ip,
      limit: 20,
      windowSec: 900,
    });
    return { ok: true as const };
  });

/**
 * Returns which fallback channels are configured. SMS is only "enabled"
 * when an SMS provider env is present; otherwise the UI shows a "Bientôt"
 * badge and the button stays disabled.
 */
export const getAuthFallbackConfig = createServerFn({ method: "GET" }).handler(
  async () => {
    const sms =
      Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) ||
      Boolean(process.env.SMS_PROVIDER_API_KEY);
    return {
      passwordEnabled: true,
      smsEnabled: sms,
    };
  },
);

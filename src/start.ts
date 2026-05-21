import { createStart, createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { renderErrorPage } from "./lib/error-page";
import { captureError } from "./lib/monitoring.server";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    // Rate-limit explicite : retour 429 propre avec Retry-After
    if (error != null && typeof error === "object" && (error as any).name === "RateLimitError") {
      const retry = Math.max(1, Number((error as any).retryAfterSec) || 60);
      return new Response(
        JSON.stringify({ error: (error as Error).message, retryAfter: retry }),
        {
          status: 429,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "retry-after": String(retry),
          },
        },
      );
    }
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    // Best-effort capture vers app_errors (never throws)
    try {
      const url = request instanceof Request ? new URL(request.url).pathname : "unknown";
      await captureError({
        source: `http:${url}`,
        error,
        severity: "error",
        context: { url, method: request instanceof Request ? request.method : null },
      });
    } catch {}
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

/**
 * Security headers globaux. Ne PAS activer CSP en mode strict ici : Stripe Elements,
 * Supabase Realtime (wss) et Resend nécessitent des connect-src/script-src étendus,
 * et un CSP mal réglé casse silencieusement le checkout. On applique les protections
 * sûres (anti-clickjacking, anti-MIME-sniff, Referrer-Policy, Permissions-Policy)
 * et on laisse CSP à activer plus tard avec une vraie passe QA.
 */
const securityHeadersMiddleware = createMiddleware().server(async ({ next }) => {
  const response = await next();
  try {
    const res = response as unknown as Response;
    if (res && typeof res.headers?.set === "function") {
      res.headers.set("X-Content-Type-Options", "nosniff");
      res.headers.set("X-Frame-Options", "DENY");
      res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
      res.headers.set(
        "Permissions-Policy",
        "camera=(self), geolocation=(self), microphone=(), payment=(self)",
      );
      res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
  } catch {
    // ignore — never block a response on header injection
  }
  return response;
});

export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware, securityHeadersMiddleware],
  functionMiddleware: [attachSupabaseAuth],
}));

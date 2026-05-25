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
      let url = "unknown";
      let method: string | null = null;
      try {
        const req = getRequest();
        url = new URL(req.url).pathname;
        method = req.method;
      } catch {}
      await captureError({
        source: `http:${url}`,
        error,
        severity: "error",
        context: { url, method },
      });
    } catch {}
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

/**
 * Security headers globaux + CSP strict.
 *
 * Allowlist :
 *  - script-src: 'self' + Stripe.js (https://js.stripe.com)
 *    'unsafe-inline' nécessaire pour le bootstrap TanStack Start (hydration scripts inline)
 *    et pour les JSON-LD inlinés via head().scripts.
 *  - style-src: 'self' + 'unsafe-inline' (Tailwind / shadcn / motion injectent du style inline)
 *    + https://fonts.googleapis.com (feuilles CSS Google Fonts)
 *  - img-src: 'self' data: blob: https: (photos chantier, signatures dataURL, OG previews)
 *  - connect-src: 'self' + Supabase REST/Realtime/Storage + Stripe API + Resend
 *  - frame-src: Stripe (Elements + 3DS hooks)
 *  - worker-src: 'self' blob: (service worker + workers internes)
 *  - font-src: 'self' data: + https://fonts.gstatic.com (fichiers de fontes Google)
 *  - frame-ancestors 'none' (anti-clickjacking renforcé, complète X-Frame-Options)
 *  - upgrade-insecure-requests : tout passe en HTTPS
 *
 * Le CSP est désactivé sur les hosts de prévisualisation Lovable (iframe éditeur)
 * pour éviter de casser le builder. Il est actif sur prod (pvia.fr, *.lovable.app).
 */
const SUPABASE_HOST = process.env.SUPABASE_URL?.replace(/^https?:\/\//, "") ?? "*.supabase.co";

function buildCsp(): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
    `img-src 'self' data: blob: https:`,
    `font-src 'self' data: https://fonts.gstatic.com`,
    `connect-src 'self' https://${SUPABASE_HOST} wss://${SUPABASE_HOST} https://*.supabase.co wss://*.supabase.co https://api.stripe.com https://api.resend.com`,
    `frame-src https://js.stripe.com https://hooks.stripe.com`,
    `worker-src 'self' blob:`,
    `manifest-src 'self'`,
    `media-src 'self' blob: data:`,
    "form-action 'self'",
    "upgrade-insecure-requests",
  ].join("; ");
}

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
      res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");

      // CSP — skip sur l'éditeur Lovable (iframe preview) pour ne pas casser le builder.
      let isPreviewIframe = false;
      try {
        const req = getRequest();
        const host = req.headers.get("host") ?? "";
        isPreviewIframe = host.includes("id-preview--") || host.includes("lovableproject.com");
      } catch {}
      if (!isPreviewIframe) {
        res.headers.set("Content-Security-Policy", buildCsp());
      }
    }
  } catch {
    // never block a response on header injection
  }
  return response;
});

export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware, securityHeadersMiddleware],
  functionMiddleware: [attachSupabaseAuth],
}));

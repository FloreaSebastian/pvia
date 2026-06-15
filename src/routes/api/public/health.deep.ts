import { createFileRoute } from "@tanstack/react-router";

const APP_VERSION = "1.0.0";

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const Route = createFileRoute("/api/public/health/deep")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const provided = request.headers.get("x-cron-secret") ?? "";
        const expected = process.env.CRON_SECRET ?? "";
        if (!expected || !timingSafeEqualStr(provided, expected)) {
          return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });
        }

        const checks: Array<{ name: string; ok: boolean; detail?: string; ms?: number }> = [];
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // DB
        let t = Date.now();
        try {
          const { error } = await supabaseAdmin
            .from("companies")
            .select("id", { head: true, count: "exact" })
            .limit(1);
          checks.push({ name: "database", ok: !error, detail: error?.message, ms: Date.now() - t });
        } catch (e: any) {
          checks.push({ name: "database", ok: false, detail: e?.message, ms: Date.now() - t });
        }

        // Storage
        t = Date.now();
        try {
          const { error } = await supabaseAdmin.storage.from("pv-assets").list("", { limit: 1 });
          checks.push({ name: "storage", ok: !error, detail: error?.message, ms: Date.now() - t });
        } catch (e: any) {
          checks.push({ name: "storage", ok: false, detail: e?.message, ms: Date.now() - t });
        }

        // Supabase Auth (admin)
        t = Date.now();
        try {
          const { error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1 });
          checks.push({ name: "supabase_auth", ok: !error, detail: error?.message, ms: Date.now() - t });
        } catch (e: any) {
          checks.push({ name: "supabase_auth", ok: false, detail: e?.message, ms: Date.now() - t });
        }

        // Config flags
        checks.push({ name: "resend_config", ok: !!process.env.RESEND_API_KEY });
        // ST-C4: granular Stripe env consistency checks
        const { checkStripeEnv } = await import("@/lib/stripe.server");
        const sandboxReport = checkStripeEnv("sandbox");
        const liveReport = checkStripeEnv("live");
        const anyStripe = !!(process.env.STRIPE_LIVE_API_KEY || process.env.STRIPE_SANDBOX_API_KEY);
        checks.push({ name: "stripe_config", ok: anyStripe, detail: anyStripe ? undefined : "no Stripe key configured" });
        checks.push({
          name: "stripe_env_sandbox",
          ok: sandboxReport.ok,
          detail: sandboxReport.errors.join("; ") || undefined,
        });
        checks.push({
          name: "stripe_env_live",
          ok: liveReport.ok,
          detail: liveReport.errors.join("; ") || undefined,
        });
        checks.push({
          name: "vapid_config",
          ok: !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
        });
        checks.push({ name: "cron_secret", ok: !!process.env.CRON_SECRET });
        checks.push({ name: "public_app_url", ok: !!process.env.PUBLIC_APP_URL });

        // ST-M6: explicit application environment.
        const { getServerAppEnv, getServerStripeEnv } = await import("@/lib/app-env.server");
        const appEnv = getServerAppEnv();
        const stripeEnv = getServerStripeEnv();
        const appEnvExplicit = !!process.env.APP_ENV;
        checks.push({
          name: "app_env",
          ok: appEnvExplicit,
          detail: appEnvExplicit
            ? `${appEnv} → stripe:${stripeEnv}`
            : `APP_ENV not set, inferred=${appEnv} (stripe:${stripeEnv})`,
        });

        const allOk = checks.every((c) => c.ok);

        return new Response(
          JSON.stringify({
            ok: allOk,
            service: "pvia",
            version: APP_VERSION,
            ts: new Date().toISOString(),
            checks,
          }),
          {
            status: allOk ? 200 : 503,
            headers: { "content-type": "application/json" },
          },
        );
      },
    },
  },
});

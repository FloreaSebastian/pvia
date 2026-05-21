import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Public, unauthenticated lightweight health endpoint for uptime probes.
 * Returns 200 if DB roundtrip works, 503 otherwise. No PII exposed.
 */
export const Route = createFileRoute("/api/public/hooks/health")({
  server: {
    handlers: {
      GET: async () => {
        const t0 = Date.now();
        try {
          const { error } = await supabaseAdmin
            .from("companies")
            .select("id", { head: true, count: "exact" })
            .limit(1);
          if (error) throw error;
          return new Response(
            JSON.stringify({ status: "ok", db_ms: Date.now() - t0, at: new Date().toISOString() }),
            { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } },
          );
        } catch (e: any) {
          console.error("[health] DB check failed:", e?.message);
          return new Response(
            JSON.stringify({ status: "fail", error: "database_unavailable" }),
            { status: 503, headers: { "content-type": "application/json", "cache-control": "no-store" } },
          );
        }
      },
    },
  },
});

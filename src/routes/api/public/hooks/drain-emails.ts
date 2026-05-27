/**
 * Cron endpoint: retry failed/retrying emails that have a stored payload.
 * Protected by x-cron-secret header (CRON_SECRET).
 * Schedule via pg_cron every 1-2 minutes.
 */
import { createFileRoute } from "@tanstack/react-router";
import { drainFailedEmails } from "@/lib/retry.server";

function unauthorized(request: Request): boolean {
  const secret = request.headers.get("x-cron-secret");
  return !secret || !process.env.CRON_SECRET || secret !== process.env.CRON_SECRET;
}

export const Route = createFileRoute("/api/public/hooks/drain-emails")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (unauthorized(request)) return new Response("Unauthorized", { status: 401 });
        try {
          const r = await drainFailedEmails(50);
          return Response.json({ ok: true, ...r });
        } catch (e) {
          console.error("[drain-emails] failed", e);
          return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
        }
      },
      GET: async ({ request }) => {
        if (unauthorized(request)) return new Response("Unauthorized", { status: 401 });
        const r = await drainFailedEmails(50);
        return Response.json({ ok: true, ...r });
      },
    },
  },
});

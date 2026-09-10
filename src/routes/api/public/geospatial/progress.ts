/** Progression réelle d'un traitement 3D (heartbeat du worker). */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { authorizeWorker } from "./claim";

const BodySchema = z.object({
  worker_id: z.string().trim().min(1).max(80),
  job_id: z.string().uuid(),
  stage: z.string().trim().max(60),
  progress_percent: z.number().int().min(0).max(100),
  label: z.string().trim().max(120).optional(),
  lease_seconds: z.number().int().min(60).max(3600).optional(),
});

export const Route = createFileRoute("/api/public/geospatial/progress")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = authorizeWorker(request);
        if (denied) return denied;

        const parsed = BodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return new Response("Requête invalide", { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin.rpc("solar_job_progress", {
          _job_id: parsed.data.job_id,
          _worker_id: parsed.data.worker_id,
          _stage: parsed.data.stage,
          _progress_percent: parsed.data.progress_percent,
          _label: parsed.data.label ?? undefined,
          _lease_seconds: parsed.data.lease_seconds ?? 900,
        });
        if (error) {
          console.error("[geospatial] progress", error.message);
          return new Response("Mise à jour impossible", { status: 500 });
        }
        return Response.json({ cancel_requested: data === true });
      },
    },
  },
});

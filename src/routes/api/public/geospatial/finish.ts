/**
 * Dépôt du résultat d'un traitement 3D.
 *
 * Le résultat brut est stocké dans `solar_engine_results`, rattaché au tenant
 * du job (jamais à une entreprise transmise par le worker).
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { authorizeWorker } from "./claim";

const BodySchema = z.object({
  worker_id: z.string().trim().min(1).max(80),
  job_id: z.string().uuid(),
  status: z.enum(["COMPLETED", "FAILED", "CANCELLED"]),
  result: z.record(z.string(), z.unknown()).optional(),
  metrics: z.record(z.string(), z.unknown()).optional(),
  error_code: z.string().trim().max(40).optional(),
  error_message: z.string().trim().max(500).optional(),
  retryable: z.boolean().optional(),
  result_version: z.string().trim().max(40).optional(),
  pipeline_version: z.string().trim().max(60).optional(),
  engine_version: z.string().trim().max(40).optional(),
});

export const Route = createFileRoute("/api/public/geospatial/finish")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = authorizeWorker(request);
        if (denied) return denied;

        const parsed = BodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return new Response("Requête invalide", { status: 400 });
        const body = parsed.data;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin.rpc("solar_job_finish", {
          _job_id: body.job_id,
          _worker_id: body.worker_id,
          _status: body.status,
          _result: (body.result ?? {}) as never,
          _metrics: (body.metrics ?? {}) as never,
          _error_code: body.error_code ?? null,
          _error_message: body.error_message ?? null,
          _result_version: body.result_version ?? null,
          _pipeline_version: body.pipeline_version ?? null,
          _engine_version: body.engine_version ?? null,
          _retryable: body.retryable ?? false,
        });
        if (error) {
          console.error("[geospatial] finish", error.message);
          return new Response("Clôture impossible", { status: 500 });
        }

        const job = data as
          | { id: string; company_id: string; model_id: string; status: string; input_hash: string | null }
          | null;
        if (!job?.id) return new Response("Traitement introuvable", { status: 404 });

        if (body.status === "COMPLETED" && body.result) {
          const origin = (body.result as { origin?: { working_crs?: string; source_crs?: string } }).origin ?? {};
          const sources = (body.result as { sources?: { provider?: string; dataset?: string }[] }).sources ?? [];
          const { error: insertError } = await supabaseAdmin.from("solar_engine_results").insert({
            company_id: job.company_id,
            model_id: job.model_id,
            job_id: job.id,
            result_kind: "roof_model",
            result_schema_version: body.result_version ?? "roof-model-v1",
            pipeline_version: body.pipeline_version ?? null,
            engine_version: body.engine_version ?? null,
            source_provider: sources[0]?.provider ?? null,
            source_dataset: sources[0]?.dataset ?? null,
            source_crs: origin.source_crs ?? null,
            working_crs: origin.working_crs ?? null,
            input_hash: job.input_hash,
            payload: body.result as never,
            metrics: (body.metrics ?? {}) as never,
          });
          if (insertError) console.error("[geospatial] result insert", insertError.message);
        }

        return Response.json({ ok: true, status: job.status });
      },
    },
  },
});

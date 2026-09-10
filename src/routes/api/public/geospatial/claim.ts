/**
 * Réservation atomique d'un traitement 3D par un worker du moteur géospatial.
 *
 * Sécurité : le worker s'authentifie par secret partagé et ne choisit jamais
 * l'entreprise — c'est la base de données qui lui remet un job déjà rattaché à
 * un tenant, créé par une fonction serveur PVIA après contrôle des droits.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const BodySchema = z.object({
  worker_id: z.string().trim().min(1).max(80),
  job_types: z.array(z.string().trim().max(40)).max(10).optional(),
  lease_seconds: z.number().int().min(60).max(3600).optional(),
});

export function authorizeWorker(request: Request): Response | null {
  const expected = process.env["SOLAR_WORKER_SECRET"];
  if (!expected) return new Response("Service non configuré", { status: 503 });
  const provided = request.headers.get("x-worker-secret");
  if (!provided || provided.length !== expected.length || provided !== expected) {
    return new Response("Non autorisé", { status: 401 });
  }
  return null;
}

export const Route = createFileRoute("/api/public/geospatial/claim")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = authorizeWorker(request);
        if (denied) return denied;

        const parsed = BodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return new Response("Requête invalide", { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin.rpc("solar_claim_job", {
          _worker_id: parsed.data.worker_id,
          _job_types: parsed.data.job_types ?? null,
          _lease_seconds: parsed.data.lease_seconds ?? 900,
        });
        if (error) {
          console.error("[geospatial] claim", error.message);
          return new Response("Réservation impossible", { status: 500 });
        }

        const job = data as { id?: string } | null;
        if (!job?.id) return Response.json({ job: null });
        return Response.json({ job });
      },
    },
  },
});

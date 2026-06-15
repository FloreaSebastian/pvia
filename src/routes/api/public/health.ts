import { createFileRoute } from "@tanstack/react-router";

const APP_VERSION = "1.0.0";

export const Route = createFileRoute("/api/public/health")({
  server: {
    handlers: {
      GET: async () => {
        return Response.json({
          ok: true,
          service: "pvia",
          version: APP_VERSION,
          ts: new Date().toISOString(),
        });
      },
    },
  },
});

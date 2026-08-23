import { createFileRoute, redirect } from "@tanstack/react-router";

/** Ancienne URL conservée : redirection permanente vers la page Solution. */
export const Route = createFileRoute("/espace-client")({
  beforeLoad: () => {
    throw redirect({ to: "/solutions/$slug", params: { slug: "espace-client" }, statusCode: 301 });
  },
});

import { createFileRoute, redirect } from "@tanstack/react-router";

/** Ancienne URL conservée : redirection permanente vers la page Solution. */
export const Route = createFileRoute("/planning-chantier")({
  beforeLoad: () => {
    throw redirect({ to: "/solutions/$slug", params: { slug: "planning" }, statusCode: 301 });
  },
});

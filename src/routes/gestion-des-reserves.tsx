import { createFileRoute, redirect } from "@tanstack/react-router";

/** Ancienne URL conservée : redirection permanente vers la page Solution. */
export const Route = createFileRoute("/gestion-des-reserves")({
  beforeLoad: () => {
    throw redirect({ to: "/solutions/$slug", params: { slug: "reserves" }, statusCode: 301 });
  },
});

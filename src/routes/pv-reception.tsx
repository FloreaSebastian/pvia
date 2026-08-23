import { createFileRoute, redirect } from "@tanstack/react-router";

/** Ancienne URL conservée : redirection permanente vers la page Solution. */
export const Route = createFileRoute("/pv-reception")({
  beforeLoad: () => {
    throw redirect({ to: "/solutions/$slug", params: { slug: "pv-reception" }, statusCode: 301 });
  },
});

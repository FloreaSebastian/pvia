import { createFileRoute, redirect } from "@tanstack/react-router";

/** Ancienne URL conservée : redirection permanente vers la page Solution. */
export const Route = createFileRoute("/mode-terrain")({
  beforeLoad: () => {
    throw redirect({ to: "/solutions/$slug", params: { slug: "terrain" }, statusCode: 301 });
  },
});

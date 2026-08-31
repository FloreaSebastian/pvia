import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * L'ancienne page de connexion client est désormais unifiée dans /login
 * (onglet « Client »). On conserve l'URL historique — utilisée dans les
 * emails déjà envoyés et les liens externes — via une redirection.
 * Les parcours de signature publics par token ne passent pas par ici.
 */
export const Route = createFileRoute("/client/login")({
  beforeLoad: () => {
    throw redirect({ to: "/login", search: { type: "client" as const } });
  },
});

import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * `/client` n'est pas une page : le tableau de bord de l'espace client est
 * `/client/dashboard`. On redirige au lieu de renvoyer un 404 (le contrôle
 * d'accès reste assuré par la route de destination).
 */
export const Route = createFileRoute("/client/")({
  beforeLoad: () => {
    throw redirect({ to: "/client/dashboard" });
  },
});

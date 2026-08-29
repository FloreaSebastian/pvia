import { MutationCache, QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { classifyBillingError } from "@/lib/billing-errors";

export const getRouter = () => {
  const queryClient = new QueryClient({
    // Toute mutation qui échoue pour raison d'abonnement/quota/fonctionnalité
    // remonte au BillingGateProvider, qui ouvre la popup adaptée.
    mutationCache: new MutationCache({
      onError: (error) => {
        if (typeof window === "undefined") return;
        if (!classifyBillingError(error)) return;
        window.dispatchEvent(new CustomEvent("pvia:mutation-error", { detail: error }));
      },
    }),
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};

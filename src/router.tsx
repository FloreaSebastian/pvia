import { MutationCache, QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { dispatchBillingError } from "@/lib/billing-event";

export const getRouter = () => {
  const queryClient = new QueryClient({
    // Toute mutation qui échoue pour raison d'abonnement/quota/fonctionnalité
    // remonte au BillingGateProvider (dédupliqué), qui ouvre la popup adaptée.
    mutationCache: new MutationCache({
      onError: (error) => {
        dispatchBillingError(error);
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

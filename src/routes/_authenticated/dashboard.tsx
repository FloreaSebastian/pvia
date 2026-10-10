import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useCompany } from "@/hooks/use-company";
import { useAuth } from "@/hooks/use-auth";
import { useSubscription } from "@/hooks/use-subscription";
import { useSuspension } from "@/hooks/use-suspension";
import { supabase } from "@/integrations/supabase/client";
import { loadDashboard } from "@/lib/dashboard";
import { DashboardView } from "@/components/dashboard/DashboardView";
import { ComplianceWidget } from "@/components/dashboard/ComplianceWidget";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
  head: () => ({
    meta: [
      { title: "Tableau de bord chantier — PVIA" },
      {
        name: "description",
        content: "Suivez vos PV, réserves, visites techniques et prochains rendez-vous chantier.",
      },
      { property: "og:title", content: "Tableau de bord chantier — PVIA" },
      {
        property: "og:description",
        content: "L’activité opérationnelle de votre entreprise BTP, en un coup d’œil.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});
function Dashboard() {
  const { activeCompanyId, activeRole, can } = useCompany();
  const { user } = useAuth();
  const billing = useSubscription();
  const suspension = useSuspension();
  const canVisit = !billing.isLoading && !billing.isError && billing.hasFeature("technical_visits");
  const canWrite =
    !!billing.access &&
    !billing.blocked &&
    !billing.isError &&
    !suspension.isLoading &&
    !suspension.suspended;
  const query = useQuery({
    queryKey: ["dashboard", activeCompanyId, user?.id, canVisit],
    queryFn: () => {
      if (!activeCompanyId) throw new Error("Entreprise non disponible");
      return loadDashboard(supabase, activeCompanyId, canVisit);
    },
    enabled: !!activeCompanyId && !billing.isLoading,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  const today = new Date().toLocaleDateString("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return (
    <DashboardView
      data={query.data}
      loading={query.isPending}
      error={query.isError}
      canCreate={can("manage") && canWrite}
      canVisit={canVisit}
      canTerrain={canWrite && (can("manage") || activeRole === "technicien")}
      userId={user?.id}
      today={today}
      documentaryFollowup={
        activeCompanyId ? (
          <ComplianceWidget key={activeCompanyId} companyId={activeCompanyId} />
        ) : null
      }
      retry={() => {
        void query.refetch();
      }}
    />
  );
}

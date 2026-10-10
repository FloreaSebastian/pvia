import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { zodValidator } from "@tanstack/zod-adapter";
import { useCompany } from "@/hooks/use-company";
import { useAuth } from "@/hooks/use-auth";
import { useSubscription } from "@/hooks/use-subscription";
import { useSuspension } from "@/hooks/use-suspension";
import { supabase } from "@/integrations/supabase/client";
import { OperationalDashboard } from "@/components/dashboard/OperationalDashboard";
import { ComplianceWidget } from "@/components/dashboard/ComplianceWidget";
import { canSignAsCompany } from "@/lib/roles";

export const Route = createFileRoute("/_authenticated/dashboard")({
  validateSearch: zodValidator(
    z.object({ planning: z.enum(["today", "upcoming"]).optional().catch(undefined) }),
  ),
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
  const { activeCompanyId, activeRole, memberships, loading, can } = useCompany();
  const { user } = useAuth();
  const billing = useSubscription();
  const suspension = useSuspension();
  const { planning } = Route.useSearch();
  const navigate = Route.useNavigate();
  const canVisit = !billing.isPending && !billing.isError && billing.hasFeature("technical_visits");
  const canWrite =
    !billing.isPending &&
    !!billing.access &&
    !billing.blocked &&
    !billing.isError &&
    !suspension.isLoading &&
    !suspension.suspended;
  const company = memberships.find((m) => m.company_id === activeCompanyId)?.company;
  if (loading)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Chargement de vos entreprises…
      </p>
    );
  if (!activeCompanyId || !company || !user)
    return (
      <section className="space-y-2">
        <h1 className="font-display text-2xl font-semibold">Tableau de bord</h1>
        <p className="text-sm text-muted-foreground">
          Aucune entreprise active disponible. Sélectionnez une entreprise pour consulter son
          activité.
        </p>
      </section>
    );
  return (
    <OperationalDashboard
      key={`${activeCompanyId}:${user.id}:${activeRole}:${canVisit}`}
      client={supabase}
      scope={{ companyId: activeCompanyId, userId: user.id, role: activeRole, canVisit }}
      companyName={company.name}
      canCreate={can("manage") && canWrite}
      canTerrain={canWrite && (can("manage") || activeRole === "technicien")}
      canLift={canWrite && canSignAsCompany(activeRole)}
      period={planning ?? "today"}
      onPeriodChange={(period) => {
        void navigate({ search: (prev) => ({ ...prev, planning: period }) });
      }}
      documentaryFollowup={<ComplianceWidget key={activeCompanyId} companyId={activeCompanyId} />}
    />
  );
}

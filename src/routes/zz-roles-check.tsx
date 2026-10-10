import { createFileRoute } from "@tanstack/react-router";
import { DashboardView, type DashboardQueries } from "@/components/dashboard/DashboardView";
import { roleCapabilities } from "@/lib/role-access";
import type { CompanyRoleValue } from "@/lib/roles";

// FIXTURE TEMPORAIRE — à supprimer après contrôle visuel.
export const Route = createFileRoute("/zz-roles-check")({
  validateSearch: (s: Record<string, unknown>) => ({ role: String(s.role ?? "directeur") }),
  component: Fixture,
});

const ok = <T,>(data: T) => ({ data, isPending: false, isError: false, isFetching: false, dataUpdatedAt: Date.now() });

function Fixture() {
  const { role } = Route.useSearch();
  const r = role as CompanyRoleValue;
  const caps = roleCapabilities(r, { writeOpen: true });
  const q = {
    drafts: ok(12345),
    pending: ok(3),
    open: ok(48),
    sites: ok(7),
    reserves: ok({ count: 0, rows: [] }),
    late: ok({ count: 0, rows: [] }),
    planning: ok({ count: 0, rows: [] }),
    recent: ok([]),
    visits: ok({ count: 0, rows: [], mine: r === "technicien" }),
  } as unknown as DashboardQueries;
  const noop = () => {};
  return (
    <div className="pvia-container py-4">
      <DashboardView
        queries={q}
        companyName="Entreprise Générale de Rénovation Énergétique et Bâtiment du Grand Ouest"
        scope={{ companyId: "c", userId: "u", role: r, canVisit: true, period: "today" } as never}
        now={new Date()}
        canCreate={caps.manage}
        canTerrain={caps.manage || (caps.terrainAssigned && r === "technicien")}
        canLift={caps.sign}
        period="today"
        onPeriodChange={noop}
        refreshing={false}
        retry={noop}
        onRetry={{ reserves: noop, late: noop, planning: noop, visits: noop, recent: noop }}
      />
    </div>
  );
}

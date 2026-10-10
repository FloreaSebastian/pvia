// FIXTURE LOCALE TEMPORAIRE — à supprimer avant commit.
import { createFileRoute } from "@tanstack/react-router";
import { DashboardView, type SectionQuery } from "@/components/dashboard/DashboardView";
import { RoleBadge } from "@/components/app/RoleBadge";
import { roleCapabilities } from "@/lib/role-access";
import { ROLE_ORDER } from "@/lib/roles";

type S = { role?: string; state?: string; write?: string };
export const Route = createFileRoute("/zz-fixture-roles")({
  validateSearch: (s: Record<string, unknown>): S => ({
    role: typeof s.role === "string" ? s.role : undefined,
    state: typeof s.state === "string" ? s.state : undefined,
    write: typeof s.write === "string" ? s.write : undefined,
  }),
  component: Fixture,
});

const LONG = "Société Coopérative de Rénovation Énergétique et Photovoltaïque du Grand Est Anciennement";
const now = new Date("2026-10-10T09:00:00Z");
function q<T>(data: T, state: string): SectionQuery<T> {
  if (state === "loading") return { data: undefined, isPending: true, isError: false, isFetching: true, dataUpdatedAt: 0 };
  if (state === "error") return { data: undefined, isPending: false, isError: true, isFetching: false, dataUpdatedAt: 0 };
  return { data, isPending: false, isError: false, isFetching: false, dataUpdatedAt: now.getTime() };
}
const pv = (i: number) => ({
  id: `pv${i}`, numero: `PV-2026-${1000 + i}`, status: i % 2 ? "en_attente" : "brouillon",
  created_at: now.toISOString(), sent_to_client_at: "2026-09-20T08:00:00Z",
  chantiers: { name: `${LONG} — chantier ${i}` }, clients: { name: `Client ${LONG} ${i}` },
});

function Fixture() {
  const { role = "directeur", state = "full", write = "1" } = Route.useSearch();
  const caps = roleCapabilities(role, { writeOpen: write === "1" });
  const err = state === "error";
  const queries = {
    drafts: q(12345, state), pending: q(987, state), open: q(43210, state), sites: q(77, state),
    reserves: q({ count: 4321, rows: [0, 1, 2].map((i) => ({ id: `r${i}`, pv_id: `pv${i}`, description: `Réserve majeure ${LONG} fissure longue à reprendre ${i}`, status: i === 1 ? "en_attente_validation" : "ouverte", due_date: "2026-10-01", pv: { numero: `PV-${i}`, clients: { name: `Client ${LONG}` }, chantiers: { name: LONG } } })) }, err ? "error" : state),
    late: q({ count: 33, rows: [1, 2, 3].map(pv) }, state),
    planning: q({ count: 9, rows: [1, 2].map((i) => ({ id: `e${i}`, title: `Intervention ${LONG}`, start_at: "2026-10-10T07:00:00Z", end_at: "2026-10-10T11:00:00Z", status: i === 1 ? "en_cours" : "planifie", chantier_id: "c1", chantiers: { name: LONG } })) }, state === "error" ? "full" : state),
    recent: q([1, 2, 3, 4].map(pv), state === "error" ? "full" : state),
    visits: q({ mine: role === "technicien", count: 15, rows: [1, 2, 3].map((i) => ({ id: `v${i}`, reference: `VT-${i}`, status: i === 1 ? "en_cours" : "planifiee", assigned_to: "u1", scheduled_at: "2026-10-11T08:00:00Z", completion_percent: 40 * i % 100, chantiers: { name: LONG }, clients: { name: LONG } })) }, state),
  };
  const noop = () => {};
  return (
    <main className="min-h-screen bg-background">
      <DashboardView
        queries={queries}
        companyName={LONG}
        scope={{ companyId: "c", userId: "u1", role, canVisit: true }}
        now={now}
        canCreate={caps.manage}
        canTerrain={caps.terrainAssigned}
        canLift={caps.sign}
        period="today"
        onPeriodChange={noop}
        refreshing={false}
        retry={noop}
        onRetry={{ reserves: noop, late: noop, planning: noop, visits: noop, recent: noop }}
      />
      <section aria-label="Badges" className="flex flex-wrap gap-2 p-4" data-badges>
        {ROLE_ORDER.map((r) => <RoleBadge key={r} role={r} long />)}
        <RoleBadge role="inconnu" />
      </section>
    </main>
  );
}

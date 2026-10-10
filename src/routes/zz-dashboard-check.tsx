import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { OperationalDashboard } from "@/components/dashboard/OperationalDashboard";
import { Button } from "@/components/ui/button";
export const Route = createFileRoute("/zz-dashboard-check")({
  component: Fixture,
  validateSearch: (s: Record<string, unknown>) => ({ scenario: String(s.scenario ?? "full") }),
});
function Fixture() {
  const { scenario } = Route.useSearch();
  const [companyId, setCompany] = useState("A");
  const [fail, setFail] = useState(false);
  const [period, setPeriod] = useState<"today" | "upcoming">("today");
  const userId = "11111111-1111-4111-8111-111111111111";
  const role =
    scenario === "technician"
      ? "technicien"
      : scenario === "readonly"
        ? "lecture_seule"
        : "directeur";
  const sb = useMemo(
    () =>
      ({
        from(table: string) {
          let head = false;
          let status = "";
          let limit = 5;
          const chain = new Proxy(
            {},
            {
              get(_, method) {
                if (method === "then")
                  return (resolve: (v: unknown) => void) => {
                    const longName = `${companyId} · Entreprise de rénovation et construction des résidences de la vallée des montagnes`;
                    const base = {
                      clients: { name: longName },
                      chantiers: {
                        name: "Rénovation de la résidence principale et extension de la toiture avec accès difficile",
                      },
                    };
                    let rows: unknown[] = [];
                    if (table === "pv")
                      rows = [0, 1, 2].map((i) => ({
                        ...base,
                        id: `${companyId}-${i}`,
                        numero: `PV-2026-0000${i}`,
                        status: "brouillon",
                        created_at: "2026-10-08T12:00:00Z",
                        sent_to_client_at: "2026-10-01T12:00:00Z",
                      }));
                    if (table === "pv_reserves")
                      rows = ["ouverte", "levee", "en_attente_validation"].map((s, i) => ({
                        id: `r${i}`,
                        pv_id: `${companyId}-0`,
                        status: s,
                        description:
                          "Reprise de l’étanchéité au raccord entre la toiture de l’extension et le mur existant, traces d’humidité constatées dans la pièce principale.",
                        due_date: "2026-10-25",
                        pv: { numero: "PV-2026-00001", ...base },
                      }));
                    if (table === "technical_visits" && status === "en_cours")
                      rows = Array.from({ length: 5 }, (_, i) => ({
                        ...base,
                        id: `v${i}`,
                        reference: `VT-2026-0000${i}`,
                        status,
                        assigned_to: userId,
                        scheduled_at: "2026-10-10T14:00:00Z",
                        completion_percent: 65,
                      }));
                    if (table === "chantier_events")
                      rows = [0, 1, 2].map((i) => ({
                        ...base,
                        id: `e${i}`,
                        chantier_id: `site${i}`,
                        title: "Visite technique et contrôle des accès de livraison",
                        start_at: "2026-10-10T08:00:00Z",
                        end_at: "2026-10-10T16:00:00Z",
                        status: i === 1 ? "en_cours" : "prevu",
                      }));
                    if (scenario === "empty") rows = [];
                    if (scenario === "loading") return;
                    const error =
                      (scenario === "sectionerror" || fail) && table === "pv_reserves"
                        ? { message: "unavailable" }
                        : null;
                    setTimeout(
                      () =>
                        resolve({
                          count: scenario === "empty" ? 0 : 12345,
                          data: head ? null : rows.slice(0, limit),
                          error,
                        }),
                      scenario === "slow" || fail ? 900 : companyId === "B" ? 700 : 20,
                    );
                  };
                return (...args: unknown[]) => {
                  if (method === "select") head = !!(args[1] as { head?: boolean })?.head;
                  if (method === "eq" && args[0] === "status") status = String(args[1]);
                  if (method === "limit") limit = Number(args[0]);
                  return chain;
                };
              },
            },
          );
          return chain;
        },
      }) as unknown as SupabaseClient<Database>,
    [companyId, scenario, fail],
  );
  return (
    <main className="mx-auto min-w-0 max-w-6xl px-3 py-4">
      <div className="mb-3 flex flex-wrap gap-2">
        <Button onClick={() => setCompany(companyId === "A" ? "B" : "A")}>
          Changer entreprise
        </Button>
        <Button onClick={() => setFail(true)}>Échec prochain refresh</Button>
      </div>
      <OperationalDashboard
        client={sb}
        scope={{ companyId, userId, role, canVisit: true }}
        companyName={`${companyId} · Entreprise des métiers du bâtiment et des travaux publics`}
        canCreate={role === "directeur"}
        canTerrain={role !== "lecture_seule"}
        canLift={role === "directeur"}
        period={period}
        onPeriodChange={setPeriod}
        now={new Date("2026-10-10T15:00:00Z")}
        documentaryFollowup={<p className="text-sm">Suivi documentaire simulé</p>}
      />
    </main>
  );
}

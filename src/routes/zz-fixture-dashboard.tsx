import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { DashboardView } from "@/components/dashboard/DashboardView";
import type { DashboardData } from "@/lib/dashboard";
export const Route = createFileRoute("/zz-fixture-dashboard")({ component: F });
const pv = (i: number) => ({ id: `p${i}`, numero: `PV-2026-00${i}`, status: i % 2 ? "brouillon" : "en_attente", created_at: "2026-10-01T10:00:00Z", sent_to_client_at: "2026-09-20T10:00:00Z", chantiers: { name: "Réhabilitation résidence Les Tilleuls bâtiment B escalier 3" }, clients: { name: "SCI Grand Ouest Patrimoine Immobilier" } });
const data: DashboardData = { counts: { drafts: 12, pending: 4, reserves: 1234, chantiers: 7, blocking: 3, late: 2, visits: 5 }, recent: [1, 2, 3].map(pv), late: [pv(2)], visits: [], events: [{ id: "e1", title: "Pose PAC", start_at: "2026-10-10T08:00:00Z", end_at: "2026-10-10T18:00:00Z", status: "prevu", chantier_id: "c", chantiers: { name: "Maison Dupont" } }, { id: "e2", title: "Réception", start_at: "2026-10-12T08:00:00Z", end_at: null, status: "reporte", chantier_id: "c", chantiers: null }] };
function F() {
  const mode = typeof window !== "undefined" ? new URLSearchParams(location.search).get("m") : null;
  const [refreshing, setR] = useState(mode === "refreshing");
  return <div className="p-3"><DashboardView data={mode === "error" ? undefined : data} loading={false} error={mode === "error" || mode === "refresherr"} refreshError={mode === "refresherr"} refreshing={refreshing} updatedAt="16:58" canCreate canVisit canTerrain retry={() => setR(true)} today="samedi 10 octobre 2026" /></div>;
}

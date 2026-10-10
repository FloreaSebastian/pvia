import { useQuery } from "@tanstack/react-query";
import { dashboardQueries, type DashboardScope, type PlanningPeriod } from "@/lib/dashboard-queries";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { DashboardView } from "./DashboardView";
import type { ReactNode } from "react";

export function OperationalDashboard({ client, scope, period, onPeriodChange, companyName, canCreate, canTerrain, canLift, documentaryFollowup, now = new Date() }: {
  client: SupabaseClient<Database>; scope: DashboardScope; period: PlanningPeriod; onPeriodChange: (period: PlanningPeriod) => void;
  companyName: string; canCreate: boolean; canTerrain: boolean; canLift: boolean; documentaryFollowup?: ReactNode; now?: Date;
}) {
  const opts = dashboardQueries(client, scope, period, now);
  const drafts = useQuery(opts.drafts);
  const pending = useQuery(opts.pending);
  const open = useQuery(opts.open);
  const sites = useQuery(opts.sites);
  const reserves = useQuery(opts.reserves);
  const late = useQuery(opts.late);
  const planning = useQuery(opts.planning);
  const recent = useQuery(opts.recent);
  const visits = useQuery({ ...opts.visits, enabled: scope.canVisit });
  const queries = [drafts, pending, open, sites, reserves, late, planning, recent, ...(scope.canVisit ? [visits] : [])];
  const refreshing = queries.some((q) => q.isFetching && q.data !== undefined);
  const retry = () => { for (const query of queries) void query.refetch(); };
  return <DashboardView companyName={companyName} now={now} scope={scope} canCreate={canCreate} canTerrain={canTerrain} canLift={canLift}
    queries={{ drafts, pending, open, sites, reserves, late, planning, recent, visits }}
    period={period} onPeriodChange={onPeriodChange} refreshing={refreshing} retry={retry} documentaryFollowup={documentaryFollowup} />;
}

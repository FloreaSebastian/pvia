import { queryOptions } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  ACTIVE_CHANTIER_STATUSES,
  EVENT_CLOSED_STATUSES,
  PV_DRAFT_STATUSES,
  PV_PENDING_STATUSES,
  VISIT_DRAFT_STATUSES,
  signatureCutoff,
  type DashboardPv,
  type DashboardVisit,
  type DashboardEvent,
} from "./dashboard";
import { isoToLocalInputs, localInputToIso } from "./visites/planning";

export type DashboardScope = {
  companyId: string;
  userId: string;
  role: string | null;
  canVisit: boolean;
};
export type PlanningPeriod = "today" | "upcoming";
export type DashboardReserve = {
  id: string;
  pv_id: string;
  description: string;
  status: string;
  due_date: string | null;
  pv: {
    numero: string;
    clients: { name: string } | null;
    chantiers: { name: string } | null;
  } | null;
};
const pvFields =
  "id,numero,status,created_at,sent_to_client_at,chantiers(name),clients(name)" as const;
const visitFields =
  "id,reference,status,assigned_to,scheduled_at,completion_percent,chantiers(name),clients(name)" as const;
const eventFields = "id,title,start_at,end_at,status,chantier_id,chantiers(name)" as const;
export const VISIT_PRIORITY_STATUSES = ["en_cours", "a_completer", "planifiee", "a_planifier"];

/** Calendar midnights are converted separately: Paris days may last 23 or 25 hours. */
export function parisDayBounds(now: Date) {
  const { date } = isoToLocalInputs(now.toISOString());
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const start = localInputToIso(date, "00:00");
  const end = localInputToIso(next.toISOString().slice(0, 10), "00:00");
  if (!start || !end) throw new Error("Date indisponible.");
  return { date, start, end };
}
export function signatureAge(iso: string, now: Date) {
  return Math.floor((now.getTime() - new Date(iso).getTime()) / 86400000);
}
export function reserveNeedsValidation(status: string) {
  return status === "levee" || status === "en_attente_validation";
}
export function dashboardDueDate(value: string) {
  // A database DATE is a calendar date, not a UTC instant.
  return new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value,
  ).toLocaleDateString("fr-FR", {
    timeZone: "Europe/Paris",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
function checked<T>(r: { data: T | null; error: unknown }): T {
  if (r.error || r.data === null) throw new Error("Informations indisponibles. Réessayez.");
  return r.data;
}
function exact(r: { count: number | null; error: unknown }) {
  if (r.error || r.count === null) throw new Error("Compteur indisponible. Réessayez.");
  return r.count;
}
export function dashboardQueries(
  sb: SupabaseClient<Database>,
  scope: DashboardScope,
  period: PlanningPeriod,
  now = new Date(),
) {
  const { companyId, userId, role, canVisit } = scope;
  const key = ["dashboard-v2", companyId, userId, role, canVisit];
  const options = <T>(name: string, queryFn: () => Promise<T>, suffix: unknown[] = []) =>
    queryOptions({ queryKey: [...key, name, ...suffix], queryFn, staleTime: 30_000, retry: 1 });
  const pvCount = () =>
    sb.from("pv").select("id", { count: "exact", head: true }).eq("company_id", companyId);
  const reserveCount = () =>
    sb.from("pv_reserves").select("id", { count: "exact", head: true }).eq("company_id", companyId);
  const bounds = parisDayBounds(now);
  const cutoff = signatureCutoff(now);
  const events = (head: boolean) => {
    let q = sb
      .from("chantier_events")
      .select(eventFields, { count: "exact", head })
      .eq("company_id", companyId)
      .not("status", "in", `(${EVENT_CLOSED_STATUSES.join(",")})`);
    if (period === "today")
      q = q
        .lt("start_at", bounds.end)
        .or(`end_at.gt.${bounds.start},and(end_at.is.null,start_at.gte.${bounds.start})`);
    else q = q.gte("start_at", bounds.end);
    return q;
  };
  const mine = role === "technicien";
  const visits = (head: boolean) => {
    let q = sb
      .from("technical_visits")
      .select(visitFields, { count: "exact", head })
      .eq("company_id", companyId);
    if (mine) q = q.eq("assigned_to", userId);
    return q;
  };
  return {
    drafts: options("drafts", async () => exact(await pvCount().in("status", PV_DRAFT_STATUSES))),
    pending: options("pending", async () =>
      exact(await pvCount().in("status", PV_PENDING_STATUSES)),
    ),
    open: options("open", async () => exact(await reserveCount().eq("status", "ouverte"))),
    sites: options("sites", async () =>
      exact(
        await sb
          .from("chantiers")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .in("status", ACTIVE_CHANTIER_STATUSES),
      ),
    ),
    reserves: options("reserves", async () => {
      const [count, rows] = await Promise.all([
        reserveCount().eq("severity", "majeure").not("status", "in", "(validee,rejetee)"),
        sb
          .from("pv_reserves")
          .select(
            "id,pv_id,description,status,due_date,pv:pv(numero,clients(name),chantiers(name))",
          )
          .eq("company_id", companyId)
          .eq("severity", "majeure")
          .not("status", "in", "(validee,rejetee)")
          .order("due_date", { nullsFirst: false })
          .order("created_at")
          .order("id")
          .limit(3),
      ]);
      return { count: exact(count), rows: checked(rows) as DashboardReserve[] };
    }),
    late: options("late", async () => {
      const [count, rows] = await Promise.all([
        pvCount().in("status", PV_PENDING_STATUSES).lt("sent_to_client_at", cutoff),
        sb
          .from("pv")
          .select(pvFields)
          .eq("company_id", companyId)
          .in("status", PV_PENDING_STATUSES)
          .lt("sent_to_client_at", cutoff)
          .order("sent_to_client_at")
          .order("id")
          .limit(3),
      ]);
      return { count: exact(count), rows: checked(rows) as DashboardPv[] };
    }),
    recent: options(
      "recent",
      async () =>
        checked(
          await sb
            .from("pv")
            .select(pvFields)
            .eq("company_id", companyId)
            .order("created_at", { ascending: false })
            .order("id")
            .limit(6),
        ) as DashboardPv[],
    ),
    planning: options(
      "planning",
      async () => {
        const [count, rows] = await Promise.all([
          events(true),
          events(false).order("start_at").order("id").limit(5),
        ]);
        return { count: exact(count), rows: checked(rows) as DashboardEvent[] };
      },
      [period, bounds.date],
    ),
    visits: options("visits", async () => {
      if (!canVisit) throw new Error("Visites non disponibles dans cette formule.");
      const count = exact(await visits(true).in("status", VISIT_DRAFT_STATUSES));
      const rows: DashboardVisit[] = [];
      // Status priority is applied in the database BEFORE each bounded read.
      for (const status of VISIT_PRIORITY_STATUSES) {
        if (rows.length === 5) break;
        rows.push(
          ...(checked(
            await visits(false)
              .eq("status", status)
              .order("scheduled_at", { nullsFirst: false })
              .order("created_at")
              .order("id")
              .limit(5 - rows.length),
          ) as DashboardVisit[]),
        );
      }
      return { count, rows, mine };
    }),
  };
}

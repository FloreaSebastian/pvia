import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  CalendarDays,
  ClipboardList,
  FileText,
  HardHat,
  AlertTriangle,
  Plus,
  RefreshCw,
  Footprints,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PvStatusPill, StatusPill, isKnownPvStatus } from "@/components/ui/status-pill";
import { VisitStatusBadge } from "@/components/visites/VisitStatusBadge";
import {
  dashboardDate,
  eventPhase,
  PV_DRAFT_STATUSES,
  type DashboardPv,
  type DashboardVisit,
  type DashboardEvent,
} from "@/lib/dashboard";
import {
  dashboardDueDate,
  reserveNeedsValidation,
  signatureAge,
  type DashboardReserve,
  type DashboardScope,
  type PlanningPeriod,
} from "@/lib/dashboard-queries";
import { reserveStatusLabel } from "@/lib/reserve-status";
import { VISIT_RESUME_SEARCH } from "@/lib/visites/resume-filter";
import type { ReactNode } from "react";

export type SectionQuery<T> = {
  data: T | undefined;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  dataUpdatedAt: number;
};
type Preview<T> = { count: number; rows: T[] };
export type DashboardQueries = {
  drafts: SectionQuery<number>;
  pending: SectionQuery<number>;
  open: SectionQuery<number>;
  sites: SectionQuery<number>;
  reserves: SectionQuery<Preview<DashboardReserve>>;
  late: SectionQuery<Preview<DashboardPv>>;
  planning: SectionQuery<Preview<DashboardEvent>>;
  recent: SectionQuery<DashboardPv[]>;
  visits: SectionQuery<Preview<DashboardVisit> & { mine: boolean }>;
};
const rowClass =
  "focus-ring grid min-h-11 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3 hover:bg-accent transition-colors";
const nameClass = "text-sm leading-relaxed [overflow-wrap:anywhere]";
function timeStamp(ms: number) {
  return new Date(ms).toLocaleTimeString("fr-FR", {
    timeZone: "Europe/Paris",
    hour: "2-digit",
    minute: "2-digit",
  });
}
export function DashboardView({
  queries: q,
  companyName,
  scope,
  now,
  canCreate,
  canTerrain,
  canLift,
  period,
  onPeriodChange,
  refreshing,
  retry,
  onRetry,
  documentaryFollowup,
}: {
  queries: DashboardQueries;
  companyName: string;
  scope: DashboardScope;
  now: Date;
  canCreate: boolean;
  canTerrain: boolean;
  canLift: boolean;
  period: PlanningPeriod;
  onPeriodChange: (period: PlanningPeriod) => void;
  refreshing: boolean;
  retry: () => void;
  onRetry: Record<"reserves" | "late" | "planning" | "visits" | "recent", () => void>;
  documentaryFollowup?: ReactNode;
}) {
  const metrics = [
    {
      label: "PV à terminer",
      query: q.drafts,
      icon: FileText,
      to: "/pv" as const,
      search: { status: "brouillon" as const, late: false },
    },
    {
      label: "Signatures attendues",
      query: q.pending,
      icon: FileText,
      to: "/pv" as const,
      search: { status: "en_attente" as const, late: false },
    },
    {
      label: "Réserves ouvertes",
      query: q.open,
      icon: AlertTriangle,
      to: "/reserves" as const,
      search: { status: "ouverte" as const, quick: "all" as const },
    },
    {
      label: "Chantiers en activité",
      query: q.sites,
      icon: HardHat,
      to: "/chantiers" as const,
      search: { active: true },
    },
  ];
  const all = [
    q.drafts,
    q.pending,
    q.open,
    q.sites,
    q.reserves,
    q.late,
    q.planning,
    q.recent,
    ...(scope.canVisit ? [q.visits] : []),
  ];
  const timestamps = all.map((x) => x.dataUpdatedAt).filter(Boolean);
  const updatedAt = timestamps.length ? Math.min(...timestamps) : 0;
  const errors = all.filter((x) => x.isError).length;
  const priorityReliable =
    q.reserves.data !== undefined &&
    q.late.data !== undefined &&
    !q.reserves.isError &&
    !q.late.isError;
  const terrainVisit = q.visits.data?.rows.find((v) => canCreate || v.assigned_to === scope.userId);
  const visitsSearch =
    scope.role === "technicien"
      ? { ...VISIT_RESUME_SEARCH, assigned: scope.userId }
      : VISIT_RESUME_SEARCH;
  return (
    <div className="flex min-w-0 flex-col gap-5 pb-6 [&_h1]:tracking-normal [&_h2]:tracking-normal">
      <header className="order-1 min-w-0 space-y-2">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-semibold">Tableau de bord</h1>
            <p className="mt-1 text-sm font-semibold [overflow-wrap:anywhere]">{companyName}</p>
            <p className="text-sm text-muted-foreground">
              {now.toLocaleDateString("fr-FR", {
                timeZone: "Europe/Paris",
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
            </p>
          </div>
          <Button
            variant="outline"
            size="icon"
            className="h-11 w-11 shrink-0"
            onClick={retry}
            disabled={all.every((x) => x.isPending) || all.some((x) => x.isFetching)}
            aria-label="Actualiser le tableau de bord"
            title="Actualiser le tableau de bord"
          >
            <RefreshCw className={refreshing ? "animate-spin" : undefined} />
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          {canCreate && (
            <Button asChild className="min-h-11">
              <Link to="/pv/new" search={{ fresh: 1 }}>
                <Plus />
                Nouveau PV
              </Link>
            </Button>
          )}
          {canCreate && scope.canVisit && (
            <Button asChild variant="outline" className="min-h-11">
              <Link to="/visites-techniques/nouvelle">
                <ClipboardList className="hidden sm:block" />
                Nouvelle visite
              </Link>
            </Button>
          )}
          {canTerrain && scope.canVisit && (
            <Button asChild variant="ghost" className="col-span-2 min-h-11 sm:col-span-1">
              {terrainVisit ? (
                <Link to="/visites-techniques/$id/terrain" params={{ id: terrainVisit.id }}>
                  <Footprints />
                  Mode terrain
                </Link>
              ) : (
                <Link to="/visites-techniques" search={visitsSearch}>
                  <Footprints />
                  Visites terrain
                </Link>
              )}
            </Button>
          )}
        </div>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {refreshing
            ? "Actualisation…"
            : updatedAt
              ? `Mis à jour à ${timeStamp(updatedAt)} · heure de Paris`
              : errors > 0
                ? "Activité indisponible pour le moment"
                : "Chargement de l’activité…"}
          {errors > 0 ? " · Certaines sections sont indisponibles" : ""}
        </p>
      </header>
      {priorityReliable && (
        <p
          className={`order-2 border-l-4 px-3 py-2 text-sm font-medium ${q.reserves.data?.count || q.late.data?.count ? "border-warning bg-warning/10" : "border-success bg-success/10"}`}
          role="status"
        >
          {q.reserves.data?.count
            ? `${q.reserves.data.count.toLocaleString("fr-FR")} réserve${q.reserves.data.count > 1 ? "s" : ""} prioritaire${q.reserves.data.count > 1 ? "s" : ""} à suivre`
            : q.late.data?.count
              ? `${q.late.data.count.toLocaleString("fr-FR")} signature${q.late.data.count > 1 ? "s" : ""} attendue${q.late.data.count > 1 ? "s" : ""} depuis plus de 7 jours`
              : "Aucune réserve prioritaire ni signature en retard."}
        </p>
      )}
      <div className="order-4 grid grid-cols-2 gap-2 xl:order-3 xl:grid-cols-4">
        {metrics.map((m) => (
          <Link
            key={m.label}
            to={m.to}
            search={m.search}
            className="focus-ring grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded-md border border-border bg-card px-3 py-2 hover:bg-accent"
          >
            <div className="min-w-0">
              <p className="text-xl font-semibold tabular-nums [overflow-wrap:anywhere]">
                {m.query.data === undefined ? "—" : m.query.data.toLocaleString("fr-FR")}
              </p>
              <p className="text-sm font-medium leading-snug [overflow-wrap:anywhere]">{m.label}</p>
              {m.query.isError && (
                <p className="text-sm text-destructive">
                  {m.query.data === undefined ? "Indisponible" : "Non actualisé"}
                </p>
              )}
            </div>
            <m.icon className="hidden h-4 w-4 shrink-0 text-muted-foreground sm:block" />
          </Link>
        ))}
      </div>
      <div className="order-3 grid min-w-0 gap-6 xl:order-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section className="min-w-0" aria-label="Priorités">
          <SectionTitle title="Priorités" icon={AlertTriangle} />
          {priorityReliable && !q.reserves.data?.count && !q.late.data?.count ? (
            <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
              Les priorités sont à jour.
            </p>
          ) : (
            <div className="mt-2 space-y-4">
              <SectionState query={q.reserves} label="Réserves prioritaires" retry={onRetry.reserves}>
                {!!q.reserves.data?.count && (
                  <>
                    <GroupHeading label="Réserves prioritaires" count={q.reserves.data.count}>
                      <Link
                        to="/reserves"
                        search={{ quick: "bloquantes", status: "all" }}
                        className="focus-ring flex min-h-11 items-center gap-1 text-sm text-primary"
                      >
                        Voir tout
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </GroupHeading>
                    <div className="divide-y divide-border border-y border-border">
                      {q.reserves.data.rows.map((r) => (
                        <article key={r.id} className="min-w-0 py-3">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                            <span className="font-semibold text-primary">
                              {reserveNeedsValidation(r.status)
                                ? "Preuve à valider"
                                : "Encore à lever"}
                            </span>
                            <span className="text-muted-foreground">
                              {reserveStatusLabel(r.status)}
                            </span>
                          </div>
                          <p className="mt-1 line-clamp-2 text-sm font-medium [overflow-wrap:anywhere]">
                            {r.description}
                          </p>
                          <Names client={r.pv?.clients?.name} site={r.pv?.chantiers?.name} />
                          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                            <p className="min-w-0 text-sm text-muted-foreground">
                              {r.due_date
                                ? `Échéance ${dashboardDueDate(r.due_date)}`
                                : "Sans échéance"}
                            </p>
                            <Button asChild variant="ghost" className="min-h-11 px-2">
                              <Link
                                to="/pv/$id"
                                params={{ id: r.pv_id }}
                                search={
                                  canLift && !reserveNeedsValidation(r.status)
                                    ? { openLift: r.id }
                                    : {}
                                }
                              >
                                {canLift && !reserveNeedsValidation(r.status) ? "Lever" : "Ouvrir"}
                                <ArrowRight />
                              </Link>
                            </Button>
                          </div>
                        </article>
                      ))}
                    </div>
                  </>
                )}
              </SectionState>
              <SectionState query={q.late} label="Signatures en retard" retry={onRetry.late}>
                {!!q.late.data?.count && (
                  <>
                    <GroupHeading label="Signature attendue > 7 jours" count={q.late.data.count}>
                      <Link
                        to="/pv"
                        search={{ status: "en_attente", late: true }}
                        className="focus-ring flex min-h-11 items-center gap-1 text-sm text-primary"
                      >
                        Voir tout
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </GroupHeading>
                    <div className="divide-y divide-border border-y border-border">
                      {q.late.data.rows.map((p) => (
                        <Link key={p.id} to="/pv/$id" params={{ id: p.id }} className={rowClass}>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold">{p.numero}</p>
                            <Names client={p.clients?.name} site={p.chantiers?.name} />
                            <p className="text-sm text-muted-foreground">
                              {p.sent_to_client_at
                                ? `Envoyé le ${dashboardDate(p.sent_to_client_at)} · ${signatureAge(p.sent_to_client_at, now)} jours révolus`
                                : "Date d’envoi non renseignée"}
                            </p>
                          </div>
                          <span className="flex items-center gap-1 text-sm text-primary">
                            Ouvrir
                            <ArrowRight className="h-4 w-4" />
                          </span>
                        </Link>
                      ))}
                    </div>
                  </>
                )}
              </SectionState>
            </div>
          )}
        </section>
        <section className="min-w-0" aria-label="Planning">
          <SectionTitle title="Planning" icon={CalendarDays} />
          <Tabs
            value={period}
            onValueChange={(v) => onPeriodChange(v === "today" ? "today" : "upcoming")}
            className="mt-2"
          >
            <TabsList className="grid h-auto w-full grid-cols-2">
              <TabsTrigger value="today" className="min-h-11">
                Aujourd’hui
              </TabsTrigger>
              <TabsTrigger value="upcoming" className="min-h-11">
                À venir
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <SectionState query={q.planning} label="Planning" retry={onRetry.planning}>
            <p className="mt-3 text-sm font-medium">
              {q.planning.data?.count.toLocaleString("fr-FR")} rendez-vous{" "}
              {period === "today" ? "aujourd’hui" : "à partir de demain"}
            </p>
            <div className="mt-1 divide-y divide-border border-y border-border">
              {q.planning.data?.rows.length ? (
                q.planning.data.rows.map((e) => (
                  <Link
                    key={e.id}
                    to="/chantiers/$id"
                    params={{ id: e.chantier_id }}
                    className={rowClass}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-primary">
                        {e.start_at ? dashboardDate(e.start_at, true) : "Non planifié"}
                        {eventPhase(e) === "en_cours"
                          ? " · En cours"
                          : eventPhase(e) === "reporte"
                            ? " · Reporté"
                            : " · Prévu"}
                      </p>
                      <p className={`${nameClass} font-medium`}>{e.title}</p>
                      <p className={`${nameClass} text-muted-foreground`}>
                        {e.chantiers?.name || "Chantier non renseigné"}
                      </p>
                      {e.end_at && (
                        <p className="text-sm text-muted-foreground">
                          Fin {dashboardDate(e.end_at, true)}
                        </p>
                      )}
                    </div>
                    <ArrowRight className="h-4 w-4 shrink-0" />
                  </Link>
                ))
              ) : (
                <Empty
                  text={
                    period === "today"
                      ? "Aucun rendez-vous aujourd’hui."
                      : "Aucun rendez-vous à venir."
                  }
                />
              )}
            </div>
          </SectionState>
          <Button asChild variant="link" className="min-h-11 px-0">
            <Link to="/chantiers/calendrier">
              Tous les rendez-vous
              <ArrowRight />
            </Link>
          </Button>
        </section>
      </div>
      {scope.canVisit && (
        <section className="order-5 min-w-0" aria-label="Visites à reprendre">
          <GroupHeading
            label={scope.role === "technicien" ? "Mes visites à reprendre" : "Visites à reprendre"}
            count={q.visits.data?.count}
          >
            <Link
              to="/visites-techniques"
              search={visitsSearch}
              className="focus-ring flex min-h-11 items-center gap-1 text-sm text-primary"
            >
              Voir les visites
              <ArrowRight className="h-4 w-4" />
            </Link>
          </GroupHeading>
          {!canTerrain && <p className="text-sm text-muted-foreground">Consultation uniquement</p>}
          <SectionState query={q.visits} label="Visites" retry={onRetry.visits}>
            <div className="mt-2 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {q.visits.data?.rows.length ? (
                q.visits.data.rows.map((v) => {
                  const edit = canTerrain && (canCreate || v.assigned_to === scope.userId);
                  return (
                    <article
                      key={v.id}
                      className="min-w-0 rounded-md border border-border bg-card p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold [overflow-wrap:anywhere]">
                          {v.reference}
                        </p>
                        <VisitStatusBadge status={v.status} className="text-sm" />
                      </div>
                      <Names client={v.clients?.name} site={v.chantiers?.name} />
                      <p className="mt-1 text-sm text-muted-foreground">
                        {v.scheduled_at ? dashboardDate(v.scheduled_at, true) : "Date à planifier"}
                      </p>
                      <div className="mt-2 flex items-center justify-between gap-2 text-sm">
                        <span>Complétude</span>
                        <span className="font-semibold tabular-nums">{v.completion_percent}%</span>
                      </div>
                      <Progress
                        value={v.completion_percent}
                        aria-label={`Complétude de ${v.reference}`}
                        aria-valuenow={v.completion_percent}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        className="mt-1"
                      />
                      <Button asChild variant="outline" className="mt-3 min-h-11 w-full">
                        {edit ? (
                          <Link to="/visites-techniques/$id/terrain" params={{ id: v.id }}>
                            {["a_planifier", "planifiee"].includes(v.status)
                              ? "Commencer"
                              : "Reprendre"}
                            <ArrowRight />
                          </Link>
                        ) : (
                          <Link to="/visites-techniques/$id" params={{ id: v.id }}>
                            Ouvrir
                            <ArrowRight />
                          </Link>
                        )}
                      </Button>
                    </article>
                  );
                })
              ) : (
                <Empty
                  text={
                    scope.role === "technicien"
                      ? "Aucune visite à reprendre ne vous est affectée."
                      : "Aucune visite à reprendre."
                  }
                />
              )}
            </div>
          </SectionState>
        </section>
      )}
      <section className="order-6 min-w-0" aria-label="Derniers dossiers PV">
        <GroupHeading label="Derniers dossiers PV">
          <Link
            to="/pv"
            className="focus-ring flex min-h-11 items-center gap-1 text-sm text-primary"
          >
            Tous les PV
            <ArrowRight className="h-4 w-4" />
          </Link>
        </GroupHeading>
        <SectionState query={q.recent} label="Derniers PV" retry={onRetry.recent}>
          <div className="mt-2 grid gap-x-6 md:grid-cols-2">
            {q.recent.data?.length ? (
              q.recent.data.map((p) => (
                <Link
                  key={p.id}
                  to="/pv/$id"
                  params={{ id: p.id }}
                  className={`${rowClass} border-b border-border`}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold [overflow-wrap:anywhere]">{p.numero}</p>
                      <span className="[&>span]:h-auto [&>span]:text-sm">
                        {isKnownPvStatus(p.status) ? (
                          <PvStatusPill status={p.status} />
                        ) : (
                          <StatusPill tone="neutral">En traitement</StatusPill>
                        )}
                      </span>
                    </div>
                    <Names client={p.clients?.name} site={p.chantiers?.name} />
                    <p className="text-sm text-muted-foreground">
                      Créé le {dashboardDate(p.created_at)}
                    </p>
                  </div>
                  <span className="flex items-center gap-1 text-sm text-primary">
                    {canCreate && PV_DRAFT_STATUSES.includes(p.status) ? "Reprendre" : "Ouvrir"}
                    <ArrowRight className="h-4 w-4" />
                  </span>
                </Link>
              ))
            ) : (
              <Empty text="Aucun procès-verbal pour cette entreprise." />
            )}
          </div>
        </SectionState>
      </section>
      {documentaryFollowup && (
        <details className="order-7 min-w-0 border-t border-border">
          <summary className="focus-ring min-h-11 cursor-pointer py-3 text-sm font-semibold">
            Suivi documentaire · preuves et réserves
          </summary>
          {documentaryFollowup}
        </details>
      )}
    </div>
  );
}
function Names({ client, site }: { client?: string | null; site?: string | null }) {
  return (
    <div className="mt-1 min-w-0">
      <p className={`${nameClass} font-medium`}>{client || "Client non renseigné"}</p>
      <p className={`${nameClass} text-muted-foreground`}>{site || "Chantier non renseigné"}</p>
    </div>
  );
}
function SectionTitle({ title, icon: Icon }: { title: string; icon: typeof FileText }) {
  return (
    <h2 className="flex min-w-0 items-center gap-2 font-display text-lg font-semibold">
      <Icon className="h-5 w-5 shrink-0 text-primary" />
      {title}
    </h2>
  );
}
function GroupHeading({
  label,
  count,
  children,
}: {
  label: string;
  count?: number;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3">
      <h2 className="min-w-0 font-display text-lg font-semibold [overflow-wrap:anywhere]">
        {label}
        {count !== undefined && (
          <span className="ml-2 text-sm font-medium tabular-nums text-muted-foreground">
            {count.toLocaleString("fr-FR")}
          </span>
        )}
      </h2>
      {children}
    </div>
  );
}
function SectionState<T>({
  query,
  label,
  children,
  retry,
}: {
  query: SectionQuery<T>;
  label: string;
  children: ReactNode;
  retry: () => void;
}) {
  return (
    <div aria-busy={query.isFetching}>
      {query.isError && (
        <div
          role="alert"
          className="my-2 border-l-4 border-warning bg-warning/10 px-3 py-2 text-sm"
        >
          {label} :{" "}
          {query.data === undefined
            ? "chargement impossible."
            : `non actualisé, données de ${timeStamp(query.dataUpdatedAt)}.`}
          <Button variant="link" onClick={retry} disabled={query.isFetching} className="min-h-11 px-1">
            Réessayer
          </Button>
        </div>
      )}
      {query.isFetching && !query.isPending && (
        <p role="status" className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
          <RefreshCw className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          Actualisation · {label.toLowerCase()}…
        </p>
      )}
      {query.data === undefined
        ? !query.isError && (
            <p role="status" className="py-4 text-sm text-muted-foreground">
              Chargement · {label.toLowerCase()}…
            </p>
          )
        : children}
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return <p className="col-span-full py-4 text-sm text-muted-foreground">{text}</p>;
}

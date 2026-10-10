import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  CalendarDays,
  ClipboardList,
  FileText,
  HardHat,
  AlertTriangle,
  PenLine,
  Plus,
  RefreshCw,
  Footprints,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PvStatusPill, StatusPill, isKnownPvStatus } from "@/components/ui/status-pill";
import { VisitStatusBadge } from "@/components/visites/VisitStatusBadge";
import type { VisitStatus } from "@/lib/visites/types";
import { dashboardDate, eventPhase, PV_DRAFT_STATUSES, type DashboardData } from "@/lib/dashboard";
import { VISIT_RESUME_SEARCH } from "@/lib/visites/resume-filter";
import type { ReactNode } from "react";

export type DashboardViewProps = {
  data?: DashboardData;
  loading: boolean;
  error: boolean;
  canCreate: boolean;
  canVisit: boolean;
  canTerrain: boolean;
  userId?: string;
  retry: () => void;
  /** Background refresh while valid data stays displayed. */
  refreshing?: boolean;
  /** Last refresh failed but previous data is still shown. */
  refreshError?: boolean;
  /** Last successful load, already formatted (Europe/Paris). */
  updatedAt?: string;
  today: string;
  documentaryFollowup?: ReactNode;
};
const linkClass =
  "focus-ring grid min-h-11 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md px-3 py-3 hover:bg-accent transition-colors";
export function DashboardView({
  data,
  loading,
  error,
  canCreate,
  canVisit,
  canTerrain,
  userId,
  retry,
  refreshing = false,
  refreshError = false,
  updatedAt,
  today,
  documentaryFollowup,
}: DashboardViewProps) {
  const initialError = error && !data;
  const metrics = [
    {
      label: "PV à terminer",
      value: data?.counts.drafts,
      icon: PenLine,
      tone: "text-primary",
      to: "/pv" as const,
      search: { status: "brouillon" as const, late: false },
    },
    {
      label: "En attente de signature",
      value: data?.counts.pending,
      icon: FileText,
      tone: "text-warning",
      to: "/pv" as const,
      search: { status: "en_attente" as const, late: false },
    },
    {
      label: "Réserves ouvertes",
      value: data?.counts.reserves,
      icon: AlertTriangle,
      tone: "text-destructive",
      to: "/reserves" as const,
      search: { status: "ouverte" as const, quick: "all" as const },
    },
    {
      label: "Chantiers en activité",
      value: data?.counts.chantiers,
      icon: HardHat,
      tone: "text-primary",
      to: "/chantiers" as const,
      search: { active: true },
    },
  ];
  const terrainVisit = data?.visits.find((v) => canCreate || v.assigned_to === userId);
  return (
    <div className="min-w-0 space-y-7 pb-6 [&_h1]:tracking-normal [&_h2]:tracking-normal">
      <header className="min-w-0 space-y-4">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{today}</p>
          <h1 className="mt-1 font-display text-2xl font-semibold">Bonjour, bienvenue</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Votre activité chantier, au même endroit.
          </p>
        </div>
        <div className="grid gap-2 min-[400px]:grid-cols-2 sm:flex sm:flex-wrap">
          {canCreate && (
            <Button asChild className="min-h-11">
              <Link to="/pv/new" search={{ fresh: 1 }}>
                <Plus />
                Nouveau PV
              </Link>
            </Button>
          )}
          {canCreate && canVisit && (
            <Button asChild variant="outline" className="min-h-11">
              <Link to="/visites-techniques/nouvelle">
                <ClipboardList />
                Nouvelle visite
              </Link>
            </Button>
          )}
          {canTerrain && canVisit && (
            <Button asChild variant="outline" className="min-h-11">
              {terrainVisit ? (
                <Link to="/visites-techniques/$id/terrain" params={{ id: terrainVisit.id }}>
                  <Footprints />
                  Mode terrain
                </Link>
              ) : (
                <Link to="/visites-techniques">
                  <Footprints />
                  Visites terrain
                </Link>
              )}
            </Button>
          )}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <Button
            variant="ghost"
            className="min-h-11 px-3"
            onClick={retry}
            disabled={loading || refreshing}
            aria-label="Actualiser le tableau de bord"
          >
            <RefreshCw className={refreshing ? "animate-spin" : undefined} />
            {refreshing ? "Actualisation…" : "Actualiser"}
          </Button>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {refreshing
              ? "Mise à jour en cours, les données affichées restent valables."
              : updatedAt
                ? `Mis à jour à ${updatedAt}`
                : null}
          </p>
        </div>
        {refreshError && data ? (
          <p role="alert" className="border-l-4 border-warning bg-warning/10 p-3 text-sm">
            Actualisation impossible. Les chiffres affichés datent de{" "}
            {updatedAt ?? "la dernière mise à jour"}.
          </p>
        ) : null}
      </header>
      {initialError ? (
        <div
          role="alert"
          className="flex flex-col gap-3 border-l-4 border-destructive bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="text-sm">Chargement impossible. Aucun compteur fiable n’est disponible.</p>
          <Button variant="outline" className="min-h-11" onClick={retry}>
            <RefreshCw />
            Réessayer
          </Button>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4" aria-busy={loading}>
        {metrics.map((k) => (
          <Link
            key={k.label}
            to={k.to}
            search={k.search}
            className="focus-ring flex min-h-11 min-w-0 flex-col rounded-lg border border-border bg-card p-3 transition-colors hover:border-primary/50 sm:p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <k.icon className={`h-5 w-5 shrink-0 ${k.tone}`} aria-hidden />
              <ArrowRight className="hidden h-4 w-4 text-muted-foreground sm:block" aria-hidden />
            </div>
            <p className="mt-2 text-2xl font-semibold tabular-nums sm:mt-3 sm:text-3xl">
              {loading ? (
                <span
                  className="block h-9 w-14 animate-pulse rounded bg-muted"
                  aria-label="Chargement"
                />
              ) : initialError || k.value === undefined ? (
                "—"
              ) : (
                k.value.toLocaleString("fr-FR")
              )}
            </p>
            <p className="mt-1 text-sm font-medium leading-tight [overflow-wrap:anywhere] sm:mt-2">
              {k.label}
            </p>
          </Link>
        ))}
      </div>
      {loading ? (
        <div role="status" className="space-y-4">
          <p className="text-sm text-muted-foreground">Chargement de votre activité…</p>
          <div className="h-40 animate-pulse rounded-md bg-muted" />
        </div>
      ) : data ? (
        <>
          <div className="grid min-w-0 gap-7 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <section className="min-w-0">
              <SectionTitle title="À traiter" icon={AlertTriangle} />
              <div className="mt-3 divide-y divide-border border-y border-border">
                <Link
                  to="/reserves"
                  search={{ quick: "bloquantes", status: "all" }}
                  className={linkClass}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">Réserves bloquantes</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Majeures, non validées ni rejetées
                    </p>
                  </div>
                  <span className="text-xl font-semibold tabular-nums text-destructive">
                    {data.counts.blocking}
                  </span>
                </Link>
                <Link
                  to="/reserves"
                  search={{ quick: "all", status: "ouverte" }}
                  className={linkClass}
                >
                  <span className="text-sm font-medium">Réserves ouvertes à traiter</span>
                  <span className="text-xl font-semibold tabular-nums">{data.counts.reserves}</span>
                </Link>
                <Link to="/pv" search={{ status: "en_attente", late: true }} className={linkClass}>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">
                      Signature attendue depuis plus de 7 jours
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Depuis l’envoi au client, si la date est renseignée
                    </p>
                  </div>
                  <span className="text-xl font-semibold tabular-nums text-warning">
                    {data.counts.late}
                  </span>
                </Link>
                {data.late.map((p) => (
                  <Link key={p.id} to="/pv/$id" params={{ id: p.id }} className={linkClass}>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {p.numero} · {p.clients?.name || "Client non renseigné"}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Envoyé le {p.sent_to_client_at ? dashboardDate(p.sent_to_client_at) : "—"}
                      </p>
                    </div>
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                ))}
                <Link to="/pv" search={{ status: "brouillon", late: false }} className={linkClass}>
                  <span className="text-sm font-medium">Brouillons de PV à terminer</span>
                  <span className="text-xl font-semibold tabular-nums">{data.counts.drafts}</span>
                </Link>
                {data.counts.visits !== null && (
                  <Link to="/visites-techniques" search={VISIT_RESUME_SEARCH} className={linkClass}>
                    <span className="text-sm font-medium">Visites à préparer ou à compléter</span>
                    <span className="text-xl font-semibold tabular-nums">{data.counts.visits}</span>
                  </Link>
                )}
              </div>
            </section>
            <section className="min-w-0">
              <SectionTitle title="Prochains rendez-vous" icon={CalendarDays} />
              <p className="mt-1 text-sm text-muted-foreground">
                En cours ou à venir, hors annulés et terminés · heure de Paris
              </p>
              <div className="mt-3 divide-y divide-border border-y border-border">
                {data.events.length ? (
                  data.events.map((e) => (
                    <Link
                      key={e.id}
                      to="/chantiers/$id"
                      params={{ id: e.chantier_id }}
                      className={linkClass}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-primary">
                          {eventPhase(e) === "en_cours"
                            ? "En cours"
                            : e.start_at
                              ? dashboardDate(e.start_at, true)
                              : "Non planifié"}
                          {eventPhase(e) === "reporte" ? " · Reporté" : ""}
                        </p>
                        <p className="mt-1 truncate text-sm font-medium">{e.title}</p>
                        <p className="truncate text-sm text-muted-foreground">
                          {e.chantiers?.name || "Chantier"}
                        </p>
                      </div>
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  ))
                ) : (
                  <Empty text="Aucun prochain rendez-vous planifié." />
                )}
              </div>
              <Button asChild variant="link" className="mt-2 min-h-11 px-0">
                <Link to="/chantiers/calendrier">
                  Ouvrir le calendrier
                  <ArrowRight />
                </Link>
              </Button>
            </section>
          </div>
          {canVisit && (
            <section className="min-w-0">
              <SectionTitle title="Visites à reprendre" icon={ClipboardList} />
              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {data.visits.length ? (
                  data.visits.map((v) => {
                    const edit = canTerrain && (canCreate || v.assigned_to === userId);
                    return (
                      <article
                        key={v.id}
                        className="min-w-0 rounded-lg border border-border bg-card p-4"
                      >
                        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                          <p className="truncate text-sm font-semibold">{v.reference}</p>
                          <VisitStatusBadge status={v.status as VisitStatus} />
                        </div>
                        <p className="mt-3 truncate text-sm font-medium">
                          {v.clients?.name || "Client non renseigné"}
                        </p>
                        <p className="truncate text-sm text-muted-foreground">
                          {v.chantiers?.name || "Chantier non renseigné"}
                        </p>
                        <p className="mt-2 text-sm text-muted-foreground">
                          {v.scheduled_at
                            ? dashboardDate(v.scheduled_at, true)
                            : "Date à planifier"}{" "}
                          · {v.completion_percent}% renseigné
                        </p>
                        <Button asChild variant="outline" className="mt-3 min-h-11 w-full">
                          {edit ? (
                            <Link to="/visites-techniques/$id/terrain" params={{ id: v.id }}>
                              Reprendre
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
                  <Empty text="Aucune visite en préparation ou en cours." />
                )}
              </div>
            </section>
          )}
          <section className="min-w-0">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
              <SectionTitle title="Derniers dossiers PV" icon={FileText} />
              <Button asChild variant="link" className="min-h-11 px-0">
                <Link to="/pv">
                  Tous les PV
                  <ArrowRight />
                </Link>
              </Button>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {data.recent.length ? (
                data.recent.map((p) => (
                  <article
                    key={p.id}
                    className="min-w-0 rounded-lg border border-border bg-card p-4"
                  >
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                      <p className="truncate text-sm font-semibold">{p.numero}</p>
                      <span className="[&>span]:h-7 [&>span]:text-sm">
                        {isKnownPvStatus(p.status) ? (
                          <PvStatusPill status={p.status} />
                        ) : (
                          <StatusPill tone="neutral">En traitement</StatusPill>
                        )}
                      </span>
                    </div>
                    <p className="mt-3 truncate text-sm font-medium">
                      {p.clients?.name || "Client non renseigné"}
                    </p>
                    <p className="truncate text-sm text-muted-foreground">
                      {p.chantiers?.name || "Chantier non renseigné"}
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Créé le {dashboardDate(p.created_at)}
                    </p>
                    <Button asChild variant="outline" className="mt-3 min-h-11 w-full">
                      <Link to="/pv/$id" params={{ id: p.id }}>
                        {canCreate && PV_DRAFT_STATUSES.includes(p.status) ? "Reprendre" : "Ouvrir"}
                        <ArrowRight />
                      </Link>
                    </Button>
                  </article>
                ))
              ) : (
                <Empty text="Aucun procès-verbal pour cette entreprise." />
              )}
            </div>
          </section>
        </>
      ) : null}
      {documentaryFollowup}
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
function Empty({ text }: { text: string }) {
  return <p className="col-span-full py-6 text-sm text-muted-foreground">{text}</p>;
}

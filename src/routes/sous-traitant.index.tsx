import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarDays, ChevronRight, Loader2, MapPin } from "lucide-react";
import { SubcontractorShell } from "@/components/subcontractor/SubcontractorShell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getSubcontractorWorkspace } from "@/lib/subcontractor-portal.functions";
import { INTERVENTION_STATUS_LABELS, MISSION_OPTIONS } from "@/lib/subcontractor-permissions";

export const Route = createFileRoute("/sous-traitant/")({
  component: SubcontractorHome,
  head: () => ({
    meta: [
      { title: "Mes interventions — Espace sous-traitant PVIA" },
      {
        name: "description",
        content:
          "Retrouvez vos interventions planifiées, vos chantiers affectés et vos échanges avec l'entreprise donneuse d'ordre.",
      },
      { property: "og:title", content: "Espace sous-traitant PVIA" },
      { property: "og:description", content: "Vos interventions et chantiers affectés, sur mobile." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function missionLabel(v: string) {
  return MISSION_OPTIONS.find((m) => m.value === v)?.label ?? v;
}

function SubcontractorHome() {
  const load = useServerFn(getSubcontractorWorkspace);
  const { data, isLoading, error } = useQuery({
    queryKey: ["subcontractor-workspace"],
    queryFn: () => load(),
    retry: false,
  });

  const upcoming = (data?.assignments ?? []).filter((a) => a.status !== "done");
  const past = (data?.assignments ?? []).filter((a) => a.status === "done");

  return (
    <SubcontractorShell title="Mes interventions">
      {isLoading ? (
        <div className="flex h-56 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <Card className="p-5 text-sm text-muted-foreground">
          Votre accès n'est plus actif. Contactez l'entreprise qui vous a invité.
        </Card>
      ) : (data?.memberships.length ?? 0) === 0 ? (
        <Card className="p-6 text-center">
          <p className="font-medium">Aucun accès actif</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Votre accès a été suspendu ou n'a pas encore été activé.
          </p>
        </Card>
      ) : (
        <div className="space-y-5">
          <section aria-labelledby="upcoming-h">
            <h2 id="upcoming-h" className="mb-2 text-sm font-semibold text-muted-foreground">
              À venir ({upcoming.length})
            </h2>
            {upcoming.length === 0 ? (
              <Card className="p-5 text-sm text-muted-foreground">Aucune intervention planifiée.</Card>
            ) : (
              <ul className="space-y-2.5">
                {upcoming.map((a) => (
                  <li key={a.id}>
                    <Link
                      to="/sous-traitant/intervention/$id"
                      params={{ id: a.id }}
                      className="block rounded-xl border bg-background p-4 transition hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate font-medium">
                              {a.chantier?.reference ? `${a.chantier.reference} · ` : ""}
                              {a.chantier?.name}
                            </span>
                            <Badge variant="secondary" className="text-xs">
                              {INTERVENTION_STATUS_LABELS[a.status] ?? a.status}
                            </Badge>
                          </div>
                          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                            <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            {a.scheduledAt
                              ? new Date(a.scheduledAt).toLocaleString("fr-FR", {
                                  dateStyle: "medium",
                                  timeStyle: "short",
                                })
                              : "À planifier"}
                            {" · "}
                            {missionLabel(a.mission)}
                          </p>
                          {a.chantier?.city ? (
                            <p className="mt-0.5 flex items-center gap-1.5 truncate text-sm text-muted-foreground">
                              <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                              {a.chantier.city}
                            </p>
                          ) : null}
                          <p className="mt-1 text-xs text-muted-foreground">Donneur d'ordre : {a.companyName}</p>
                        </div>
                        <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {past.length > 0 && (
            <section aria-labelledby="past-h">
              <h2 id="past-h" className="mb-2 text-sm font-semibold text-muted-foreground">
                Terminées ({past.length})
              </h2>
              <ul className="space-y-2">
                {past.slice(0, 20).map((a) => (
                  <li key={a.id}>
                    <Link
                      to="/sous-traitant/intervention/$id"
                      params={{ id: a.id }}
                      className="flex min-h-14 items-center justify-between gap-3 rounded-xl border bg-background px-4 py-3 text-sm"
                    >
                      <span className="truncate">
                        {a.chantier?.reference} · {a.chantier?.name}
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </SubcontractorShell>
  );
}

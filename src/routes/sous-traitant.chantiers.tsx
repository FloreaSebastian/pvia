import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronRight, HardHat, Loader2 } from "lucide-react";
import { SubcontractorShell } from "@/components/subcontractor/SubcontractorShell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getSubcontractorWorkspace } from "@/lib/subcontractor-portal.functions";

export const Route = createFileRoute("/sous-traitant/chantiers")({
  component: SubcontractorChantiers,
  head: () => ({
    meta: [
      { title: "Mes chantiers — Espace sous-traitant PVIA" },
      {
        name: "description",
        content: "Liste des chantiers sur lesquels vous êtes affecté, avec vos interventions associées.",
      },
      { property: "og:title", content: "Mes chantiers — Espace sous-traitant PVIA" },
      { property: "og:description", content: "Vos chantiers affectés et leurs interventions." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function SubcontractorChantiers() {
  const load = useServerFn(getSubcontractorWorkspace);
  const { data, isLoading } = useQuery({
    queryKey: ["subcontractor-workspace"],
    queryFn: () => load(),
    retry: false,
  });

  const byChantier = new Map<string, { name: string; reference: string | null; company: string; items: any[] }>();
  for (const a of data?.assignments ?? []) {
    const key = a.chantierId;
    const entry = byChantier.get(key) ?? {
      name: a.chantier?.name ?? "",
      reference: a.chantier?.reference ?? null,
      company: a.companyName,
      items: [],
    };
    entry.items.push(a);
    byChantier.set(key, entry);
  }

  return (
    <SubcontractorShell title="Mes chantiers">
      {isLoading ? (
        <div className="flex h-56 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : byChantier.size === 0 ? (
        <Card className="p-6 text-center">
          <HardHat className="mx-auto h-7 w-7 text-muted-foreground" aria-hidden="true" />
          <p className="mt-2 text-sm text-muted-foreground">Aucun chantier affecté pour l'instant.</p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {Array.from(byChantier.entries()).map(([id, c]) => (
            <li key={id}>
              <Card className="p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate font-medium">
                    {c.reference ? `${c.reference} · ` : ""}
                    {c.name}
                  </h2>
                  <Badge variant="secondary" className="text-xs">
                    {c.items.length} intervention(s)
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">Donneur d'ordre : {c.company}</p>
                <ul className="mt-3 divide-y">
                  {c.items.map((a) => (
                    <li key={a.id}>
                      <Link
                        to="/sous-traitant/intervention/$id"
                        params={{ id: a.id }}
                        className="flex min-h-12 items-center justify-between gap-2 text-sm"
                      >
                        <span className="truncate">
                          {a.scheduledAt
                            ? new Date(a.scheduledAt).toLocaleDateString("fr-FR", {
                                dateStyle: "medium",
                              })
                            : "À planifier"}
                          {" · "}
                          {a.mission}
                        </span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </SubcontractorShell>
  );
}

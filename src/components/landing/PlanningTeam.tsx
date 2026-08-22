import { SectionTitle } from "@/components/landing/SectionTitle";
import { CalendarMockup } from "@/components/landing/mockups";

const chain = ["Planifier", "Intervenir", "Réceptionner", "Lever", "Clôturer"];

const items = [
  { t: "Calendrier", d: "Vues jour, semaine et mois pour vos interventions." },
  { t: "Planning d'équipe", d: "Attribuez les interventions à vos techniciens." },
  { t: "Événements chantier", d: "Visites, réceptions et levées au même endroit." },
];

export function PlanningTeam() {
  return (
    <section id="planning" className="scroll-mt-20 py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionTitle
          eyebrow="Planning & équipe"
          title="Le chantier ne s'arrête pas au PV."
          description="Du planning à la clôture, tout suit la même ligne."
        />
        <div className="mt-12 grid items-center gap-8 lg:grid-cols-2 lg:gap-14">
          <div className="min-w-0 lg:order-2">
            <CalendarMockup />
          </div>
          <div className="min-w-0 lg:order-1">
            <ul className="space-y-3">
              {items.map((i) => (
                <li
                  key={i.t}
                  className="min-w-0 rounded-xl border border-border bg-card p-4 shadow-elevation-sm"
                >
                  <p className="text-sm font-semibold text-foreground">{i.t}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{i.d}</p>
                </li>
              ))}
            </ul>
            <ol className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-2">
              {chain.map((c, i) => (
                <li key={c} className="flex items-center gap-2">
                  <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                    {c}
                  </span>
                  {i < chain.length - 1 && (
                    <span aria-hidden="true" className="text-muted-foreground">
                      ›
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}

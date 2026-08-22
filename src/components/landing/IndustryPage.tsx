import { Link } from "@tanstack/react-router";
import { ArrowRight, Check } from "lucide-react";
import { MarketingPage } from "@/components/landing/MarketingPage";
import { Workflow } from "@/components/landing/Workflow";
import { PhoneMockup, ReserveMockup } from "@/components/landing/mockups";
import { SOLUTIONS, type Solution } from "@/components/landing/solutions-data";

/** Gabarit d'une page métier. Le contenu vient de `solutions-data`. */
export function IndustryPage({ solution }: { solution: Solution }) {
  const others = SOLUTIONS.filter((s) => s.slug !== solution.slug);

  return (
    <MarketingPage
      eyebrow={`Solutions · ${solution.label}`}
      title={solution.title}
      description={solution.intro}
      bullets={["PV signé sur place", "Photos rattachées", "Réserves suivies", "Espace client"]}
      ctaLabel="Essayer pour mon entreprise"
    >
      <section className="py-16 sm:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-10 lg:grid-cols-2 lg:gap-14">
            <div className="min-w-0">
              <h2 className="text-balance text-2xl tracking-tight text-foreground sm:text-3xl">
                Ce qui se passe aujourd'hui sur vos chantiers
              </h2>
              <ul className="mt-6 space-y-3">
                {solution.context.map((c) => (
                  <li
                    key={c}
                    className="min-w-0 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground"
                  >
                    {c}
                  </li>
                ))}
              </ul>
            </div>
            <div className="min-w-0">
              <h2 className="text-balance text-2xl tracking-tight text-foreground sm:text-3xl">
                Ce que PVIA change
              </h2>
              <ul className="mt-6 space-y-4">
                {solution.withPvia.map((w) => (
                  <li key={w.title} className="min-w-0">
                    <p className="flex items-start gap-2 text-sm font-semibold text-foreground">
                      <Check aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <span className="min-w-0">{w.title}</span>
                    </p>
                    <p className="mt-1 pl-6 text-sm leading-relaxed text-muted-foreground">
                      {w.text}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <Workflow />

      <section className="py-16 sm:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
            <div className="min-w-0">
              <h2 className="text-balance text-2xl tracking-tight text-foreground sm:text-3xl">
                Des réserves typiques de votre métier
              </h2>
              <p className="mt-3 text-pretty text-muted-foreground">
                Exemples de points relevés en réception. Dans PVIA, chacun reçoit une gravité, un
                responsable, des photos avant/après et un état suivi jusqu'à la validation du
                client.
              </p>
              <ul className="mt-6 flex flex-wrap gap-2">
                {solution.reserves.map((r) => (
                  <li
                    key={r}
                    className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground"
                  >
                    {r}
                  </li>
                ))}
              </ul>
            </div>
            <div className="grid min-w-0 gap-6 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <ReserveMockup />
              <div className="flex justify-center">
                <PhoneMockup />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-border py-16 sm:py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl tracking-tight text-foreground sm:text-3xl">Autres métiers</h2>
          <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {others.map((s) => (
              <li key={s.slug}>
                <Link
                  to="/solutions/$slug"
                  params={{ slug: s.slug }}
                  className="group flex min-h-[5rem] min-w-0 items-center justify-between gap-2 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-foreground">
                      {s.label}
                    </span>
                    <span className="mt-1 block text-sm text-muted-foreground">{s.title}</span>
                  </span>
                  <ArrowRight
                    aria-hidden
                    className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </MarketingPage>
  );
}

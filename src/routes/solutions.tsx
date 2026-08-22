import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { MarketingPage } from "@/components/landing/MarketingPage";
import { Workflow } from "@/components/landing/Workflow";
import { ProductLinks } from "@/components/landing/ProductLinks";
import { SOLUTIONS } from "@/components/landing/solutions-data";
import { DashboardMockup } from "@/components/landing/mockups";

const TITLE = "Solutions métiers — logiciel de réception de travaux | PVIA";
const DESCRIPTION =
  "PVIA s'adapte à votre métier : photovoltaïque, climatisation et PAC, électricité, plomberie, rénovation et construction. Même méthode de réception, vos réalités de terrain.";

export const Route = createFileRoute("/solutions")({
  component: SolutionsLayout,
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://pvia.fr/solutions" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESCRIPTION },
    ],
  }),
});

function SolutionsLayout() {
  return <Outlet />;
}

/** Contenu de /solutions, rendu par la route index enfant. */
export function SolutionsOverview() {
  return (
    <MarketingPage
      eyebrow="Solutions"
      title="Votre métier a ses réserves. PVIA a la même méthode."
      description="Photovoltaïque, climatisation, électricité, plomberie, rénovation ou construction : la réception change de vocabulaire, pas de logique. Photos, réserves, signature, levée, validation."
      bullets={["6 métiers", "Une seule méthode", "PV signé sur place"]}
      ctaLabel="Essayer pour mon entreprise"
      visual={<DashboardMockup />}
    >
      <section className="py-16 sm:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <h2 className="text-balance text-2xl tracking-tight text-foreground sm:text-3xl">
            Choisissez votre métier
          </h2>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SOLUTIONS.map((s) => (
              <li key={s.slug}>
                <Link
                  to="/solutions/$slug"
                  params={{ slug: s.slug }}
                  className="group flex h-full min-w-0 flex-col rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/50"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-base font-semibold text-foreground">{s.label}</span>
                    <ArrowRight
                      aria-hidden
                      className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                    />
                  </span>
                  <span className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {s.intro}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <Workflow
        title="Le même déroulé, quel que soit le lot."
        description="C'est ce qui permet à une entreprise multi-métiers de garder une seule manière de réceptionner."
      />

      <ProductLinks currentTo="/solutions" />
    </MarketingPage>
  );
}

import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/landing/Header";
import { Footer } from "@/components/landing/Footer";
import { SOLUTIONS } from "@/components/landing/solutions-data";
import { SOLUTION_GROUPS } from "@/components/landing/solutions/content";
import {
  CompareSection,
  Section,
  SectionHeading,
  SolutionCta,
} from "@/components/landing/solutions/sections";
import { DashboardMockup } from "@/components/landing/mockups";

const GLOBAL_FLOW = [
  "Préparer",
  "Intervenir",
  "Réceptionner",
  "Signer",
  "Lever les réserves",
  "Informer le client",
  "Retrouver l'historique",
];

/** Page hub /solutions : le processus complet, puis l'accès aux pages détaillées. */
export function SolutionsHub() {
  return (
    <div className="landing-editorial min-h-screen overflow-x-hidden bg-background">
      <Header />
      <main>
        <section className="relative overflow-hidden pt-28 sm:pt-36">
          <div aria-hidden className="absolute inset-x-0 top-0 -z-10 h-[420px] bg-radial-fade" />
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] lg:gap-14">
              <div className="min-w-0">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                  PVIA · Solutions
                </span>
                <h1 className="mt-3 text-balance font-display text-[clamp(1.9rem,6vw,3.4rem)] font-bold leading-[1.06] tracking-tight text-foreground">
                  Maîtrisez toute la réception d'un chantier, du terrain jusqu'à la clôture.
                </h1>
                <p className="mt-5 max-w-2xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
                  PVIA n'est pas un générateur de PDF. C'est l'environnement dans lequel vos
                  chantiers, vos réceptions, vos réserves, vos signatures, vos documents et vos
                  clients restent reliés entre eux.
                </p>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <Button size="lg" className="min-h-12 w-full shadow-elevation-md sm:w-auto" asChild>
                    <Link to="/signup">
                      Essayer PVIA gratuitement <ArrowRight aria-hidden className="ml-1 h-4 w-4" />
                    </Link>
                  </Button>
                  <Button size="lg" variant="outline" className="min-h-12 w-full sm:w-auto" asChild>
                    <Link to="/comment-ca-marche">Voir comment ça fonctionne</Link>
                  </Button>
                </div>
                <p className="mt-4 text-sm text-muted-foreground">
                  14 jours gratuits · Sans engagement · Sans carte bancaire
                </p>
              </div>
              <div className="min-w-0">
                <DashboardMockup />
              </div>
            </div>
          </div>
        </section>

        <Section bordered muted>
          <SectionHeading
            eyebrow="Le processus"
            title="Un seul déroulé, du premier passage au dossier archivé."
            description="Chaque étape alimente la suivante. C'est ce qui évite la ressaisie et les informations perdues entre le chantier et le bureau."
          />
          <ol className="mt-8 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {GLOBAL_FLOW.map((s, i) => (
              <li
                key={s}
                className="flex min-w-0 items-center gap-2.5 rounded-xl border border-border bg-card px-3.5 py-3"
              >
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
                  {i + 1}
                </span>
                <span className="min-w-0 text-sm font-medium text-foreground">{s}</span>
              </li>
            ))}
          </ol>
        </Section>

        <Section bordered>
          <SectionHeading
            eyebrow="Explorer PVIA"
            title="Chaque partie du travail a sa solution."
            description="Neuf pages pour comprendre précisément comment PVIA traite chaque étape de votre réception."
          />
          <div className="mt-10 space-y-10">
            {SOLUTION_GROUPS.map((group) => (
              <div key={group.title} className="min-w-0">
                <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {group.title}
                </h3>
                <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {group.items.map((p) => (
                    <li key={p.slug}>
                      <Link
                        to="/solutions/$slug"
                        params={{ slug: p.slug }}
                        className="group flex h-full min-w-0 flex-col rounded-2xl border border-border bg-card p-5 shadow-elevation-sm transition-colors hover:border-primary/50"
                      >
                        <span className="flex items-center gap-2.5">
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                            <p.navIcon aria-hidden className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 truncate text-base font-semibold text-foreground">
                            {p.navLabel}
                          </span>
                          <ArrowRight
                            aria-hidden
                            className="ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                          />
                        </span>
                        <span className="mt-3 text-sm leading-relaxed text-muted-foreground">
                          {p.subtitle.split(".")[0]}.
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>

        <CompareSection />

        <Section bordered muted>
          <SectionHeading
            eyebrow="Métiers"
            title="Votre métier a ses réserves. PVIA a la même méthode."
            description="Photovoltaïque, climatisation, électricité, plomberie, rénovation ou construction : le vocabulaire change, la logique de réception reste la même."
          />
          <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {SOLUTIONS.map((s) => (
              <li key={s.slug}>
                <Link
                  to="/solutions/$slug"
                  params={{ slug: s.slug }}
                  className="group flex min-h-[3.5rem] min-w-0 items-center justify-between gap-2 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:border-primary/50"
                >
                  <span className="truncate text-sm font-semibold text-foreground">{s.label}</span>
                  <ArrowRight
                    aria-hidden
                    className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </Section>

        <SolutionCta title="Votre prochaine réception peut déjà être plus simple." />
      </main>
      <Footer />
    </div>
  );
}

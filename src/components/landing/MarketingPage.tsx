import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/landing/Header";
import { Footer } from "@/components/landing/Footer";
import { CTA } from "@/components/landing/CTA";

type Props = {
  eyebrow: string;
  title: string;
  description: string;
  /** Points clés affichés sous le titre. */
  bullets?: string[];
  children: ReactNode;
};

/**
 * Gabarit des pages produit publiques (fonctionnalités, réserves, terrain…).
 * Reprend la direction éditoriale de la homepage.
 */
export function MarketingPage({ eyebrow, title, description, bullets, children }: Props) {
  return (
    <div className="landing-editorial min-h-screen bg-background">
      <Header />
      <main>
        <section className="relative overflow-hidden pt-28 sm:pt-36">
          <div aria-hidden className="absolute inset-x-0 top-0 -z-10 h-[420px] bg-radial-fade" />
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                {eyebrow}
              </span>
              <h1 className="mt-3 text-balance text-[clamp(2rem,6vw,3.5rem)] tracking-tight text-foreground">
                {title}
              </h1>
              <p className="mt-5 max-w-2xl text-pretty text-base text-muted-foreground sm:text-lg">
                {description}
              </p>

              {bullets && bullets.length > 0 && (
                <ul className="mt-7 flex flex-wrap gap-2">
                  {bullets.map((b) => (
                    <li
                      key={b}
                      className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground"
                    >
                      {b}
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button size="lg" className="min-h-12 w-full sm:w-auto" asChild>
                  <Link to="/signup">
                    Essayer gratuitement <ArrowRight className="ml-1 h-4 w-4" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" className="min-h-12 w-full sm:w-auto" asChild>
                  <Link to="/tarifs">Voir les tarifs</Link>
                </Button>
              </div>
              <p className="mt-4 text-sm text-muted-foreground">
                14 jours gratuits · Sans engagement
              </p>
            </div>
          </div>
        </section>

        {children}
        <CTA />
      </main>
      <Footer />
    </div>
  );
}

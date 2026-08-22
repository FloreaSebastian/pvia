import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

export function CTA({ ctaLabel = "Essayer PVIA gratuitement" }: { ctaLabel?: string } = {}) {
  return (
    <section className="py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-3xl border border-border bg-foreground px-5 py-14 text-center text-background shadow-elevation-xl sm:px-12 sm:py-20">
          <div
            aria-hidden="true"
            className="absolute inset-0 -z-0 opacity-[0.07]"
            style={{
              backgroundImage:
                "linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)",
              backgroundSize: "48px 48px",
              maskImage: "radial-gradient(ellipse at center, black 30%, transparent 75%)",
            }}
          />
          <div className="relative mx-auto max-w-2xl">
            <h2 className="text-balance font-display text-[clamp(1.6rem,5vw,2.75rem)] font-bold leading-tight tracking-tight">
              Votre prochain chantier mérite mieux qu'un PV papier.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-pretty text-background/75">
              Centralisez vos réceptions, réserves, photos et signatures avec PVIA.
            </p>
            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Button
                size="lg"
                variant="secondary"
                className="min-h-12 w-full px-6 text-foreground shadow-elevation-lg sm:w-auto"
                asChild
              >
                <Link to="/signup">
                  {ctaLabel} <ArrowRight className="ml-1 h-4 w-4" />
                </Link>
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="min-h-12 w-full border-background/25 bg-transparent px-6 text-background hover:bg-background/10 hover:text-background sm:w-auto"
                asChild
              >
                <Link to="/tarifs">Voir les tarifs</Link>
              </Button>
            </div>
            <p className="mt-5 text-sm text-background/70">14 jours gratuits · Sans engagement</p>
          </div>
        </div>
      </div>
    </section>
  );
}

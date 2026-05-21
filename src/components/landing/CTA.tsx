import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ArrowRight, Sparkles } from "lucide-react";

export function CTA() {
  return (
    <section className="py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-3xl bg-foreground px-8 py-16 text-center text-background shadow-2xl sm:px-16 sm:py-24">
          {/* Grid pattern */}
          <div
            className="absolute inset-0 -z-0 opacity-[0.08]"
            style={{
              backgroundImage:
                "linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)",
              backgroundSize: "48px 48px",
              maskImage: "radial-gradient(ellipse at center, black 30%, transparent 75%)",
            }}
          />
          {/* Aurora glow */}
          <div
            className="absolute inset-0 -z-0 opacity-40"
            style={{
              backgroundImage:
                "radial-gradient(circle at 15% 20%, oklch(0.55 0.22 255) 0, transparent 45%), radial-gradient(circle at 85% 80%, oklch(0.6 0.18 200) 0, transparent 45%), radial-gradient(circle at 50% 110%, oklch(0.65 0.18 320) 0, transparent 50%)",
            }}
          />

          <div className="relative">
            <span className="inline-flex items-center gap-2 rounded-full border border-background/20 bg-background/5 px-3 py-1 text-xs font-medium text-background/80 backdrop-blur">
              <Sparkles className="h-3 w-3" />
              Essai 14 jours · Sans carte bancaire
            </span>
            <h2 className="mx-auto mt-6 max-w-2xl text-balance font-display text-3xl font-bold tracking-tight sm:text-5xl">
              Prêt à digitaliser vos réceptions de travaux ?
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-balance text-background/70 sm:text-lg">
              Rejoignez les 1 200 entreprises du BTP qui économisent 4 heures par PV avec PVIA.
            </p>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Button size="lg" variant="secondary" className="h-12 px-6 text-foreground shadow-xl" asChild>
                <Link to="/signup">
                  Créer mon premier PV <ArrowRight className="ml-1 h-4 w-4" />
                </Link>
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-12 border-background/20 bg-transparent px-6 text-background hover:bg-background/10 hover:text-background"
              >
                Demander une démo
              </Button>
            </div>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-background/60">
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-success" /> Hébergé en France
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-success" /> RGPD conforme
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-success" /> Support FR 7j/7
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

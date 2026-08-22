import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ArrowRight, HardHat, ShieldCheck } from "lucide-react";
import { DashboardMockup, FloatingCard, PhoneMockup } from "@/components/landing/mockups";

export function Hero() {
  return (
    <section id="hero" className="relative isolate overflow-hidden">
      <div className="absolute inset-x-0 top-0 -z-10 h-[560px] bg-radial-fade" />
      <div className="mx-auto max-w-7xl px-4 pb-16 pt-28 sm:px-6 sm:pb-24 sm:pt-36 lg:px-8">
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-10">
          {/* Texte */}
          <div className="min-w-0 max-w-xl">
            <span className="inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-primary shadow-elevation-sm">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">La réception de chantier, enfin simple.</span>
            </span>

            <h1 className="mt-5 text-balance font-display text-[clamp(2rem,7vw,3.75rem)] font-bold leading-[1.08] tracking-tight text-foreground">
              Réceptionnez vos chantiers.
              <span className="block text-primary">Sans papier. Sans oubli.</span>
            </h1>

            <p className="mt-5 text-pretty text-base text-muted-foreground sm:text-lg">
              PVIA centralise vos procès-verbaux, réserves, photos et signatures dans un seul
              outil, du chantier jusqu'au PDF signé.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Button size="lg" className="min-h-12 w-full px-6 shadow-elevation-lg sm:w-auto" asChild>
                <Link to="/signup">
                  Essayer gratuitement <ArrowRight className="ml-1 h-4 w-4" />
                </Link>
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="min-h-12 w-full px-6 sm:w-auto"
                asChild
              >
                <a href="#comment-ca-marche">Voir comment ça marche</a>
              </Button>
            </div>

            <p className="mt-4 text-sm font-medium text-foreground">
              14 jours gratuits · Sans engagement
            </p>
            <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
              <HardHat className="h-4 w-4 shrink-0" />
              Pensé pour les professionnels du BTP
            </p>
          </div>

          {/* Visuel produit */}
          <div className="relative min-w-0">
            <DashboardMockup />
            <PhoneMockup className="absolute -bottom-8 -left-2 hidden w-[150px] sm:block sm:w-[180px] lg:-left-10" />
            <FloatingCard label="PV signé" className="absolute -top-3 right-3 sm:right-6" />
            <FloatingCard
              label="3 réserves levées"
              tone="primary"
              className="absolute -bottom-4 right-2 sm:right-8"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

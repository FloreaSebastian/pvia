import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

export function CTA() {
  return (
    <section className="py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-3xl bg-foreground px-8 py-16 text-center text-background shadow-2xl sm:px-16 sm:py-20">
          <div
            className="absolute inset-0 -z-0 opacity-20"
            style={{
              backgroundImage:
                "radial-gradient(circle at 20% 20%, oklch(0.5 0.2 255) 0, transparent 40%), radial-gradient(circle at 80% 80%, oklch(0.5 0.18 200) 0, transparent 40%)",
            }}
          />
          <div className="relative">
            <h2 className="mx-auto max-w-2xl text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              Prêt à digitaliser vos réceptions de travaux ?
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-background/70">
              Essayez PVIA gratuitement pendant 14 jours. Sans carte bancaire, sans engagement.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button size="lg" variant="secondary" className="h-12 px-6 text-foreground">
                Créer mon PV de réception <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-12 border-background/20 bg-transparent px-6 text-background hover:bg-background/10 hover:text-background"
              >
                Demander une démo
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

import { ArrowRight, Check, X } from "lucide-react";
import { SectionTitle } from "@/components/landing/SectionTitle";

const before = [
  "Photos dans le téléphone",
  "Réserves dans WhatsApp",
  "PV dans un dossier",
  "Signature sur papier",
  "Informations difficiles à retrouver",
];

const after = [
  "Un chantier",
  "Un PV",
  "Des réserves suivies",
  "Des photos avant/après",
  "Une signature",
  "Un historique complet",
];

export function ProblemSolution() {
  return (
    <section id="pourquoi" className="py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionTitle
          eyebrow="Le quotidien"
          title="Fini les réceptions de chantier dispersées."
          description="Avec PVIA, tout reste attaché au chantier : documents, preuves et suivi au même endroit."
        />

        <div className="mx-auto mt-12 grid max-w-4xl items-stretch gap-4 md:grid-cols-[1fr_auto_1fr]">
          <div className="min-w-0 rounded-2xl border border-border bg-muted/40 p-5 sm:p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Aujourd'hui
            </p>
            <ul className="mt-4 space-y-2.5">
              {before.map((b) => (
                <li key={b} className="flex min-w-0 items-start gap-2.5">
                  <X className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 text-sm text-muted-foreground">{b}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="grid place-items-center md:px-1">
            <span className="grid h-10 w-10 place-items-center rounded-full border border-border bg-card text-primary shadow-elevation-sm">
              <ArrowRight className="h-4 w-4 rotate-90 md:rotate-0" aria-hidden="true" />
            </span>
          </div>

          <div className="min-w-0 rounded-2xl border border-primary/30 bg-card p-5 shadow-elevation-md sm:p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
              Avec PVIA
            </p>
            <ul className="mt-4 space-y-2.5">
              {after.map((a) => (
                <li key={a} className="flex min-w-0 items-start gap-2.5">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                  <span className="min-w-0 text-sm font-medium text-foreground">{a}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

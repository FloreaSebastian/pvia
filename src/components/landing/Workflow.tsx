import { ChevronRight } from "lucide-react";

const STEPS = [
  "Visite technique",
  "Chantier",
  "Intervention",
  "Photos",
  "PV",
  "Réserves",
  "Signature",
  "PDF",
  "Levée",
  "Validation",
  "Historique",
] as const;

/**
 * Fil conducteur PVIA : le processus complet, du chantier à l'historique.
 * Réutilisé sur la homepage et les pages produit.
 */
export function Workflow({
  title = "PVIA couvre tout le processus, pas seulement le PDF.",
  description = "Une seule chaîne d'information, du premier passage sur le chantier jusqu'à la validation du client.",
  className = "",
}: {
  title?: string;
  description?: string;
  className?: string;
}) {
  return (
    <section className={`border-y border-border bg-muted/30 py-16 sm:py-24 ${className}`}>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            Le parcours
          </span>
          <h2 className="mt-3 text-balance text-2xl tracking-tight text-foreground sm:text-3xl">
            {title}
          </h2>
          <p className="mt-3 text-pretty text-muted-foreground">{description}</p>
        </div>

        <ol className="mt-8 flex flex-wrap items-center gap-x-1.5 gap-y-2">
          {STEPS.map((s, i) => (
            <li key={s} className="flex min-w-0 items-center gap-1.5">
              <span className="rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground sm:text-sm">
                {s}
              </span>
              {i < STEPS.length - 1 && (
                <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { SOLUTIONS } from "@/components/landing/solutions-data";

/** Aperçu des pages métier depuis la homepage. */
export function SolutionsPreview() {
  return (
    <section className="border-t border-border py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            Métiers
          </span>
          <h2 className="mt-3 text-balance text-2xl tracking-tight text-foreground sm:text-3xl">
            Une réception, six façons de la vivre.
          </h2>
          <p className="mt-3 text-pretty text-muted-foreground">
            Les réserves ne se ressemblent pas d'un métier à l'autre. La méthode, si.
          </p>
        </div>

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

        <div className="mt-6">
          <Link
            to="/solutions"
            className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            Voir toutes les solutions métiers <ArrowRight aria-hidden className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}

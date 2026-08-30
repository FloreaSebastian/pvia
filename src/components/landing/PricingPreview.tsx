import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PUBLIC_PLANS, TRIAL_DAYS, formatEur, VAT_RATE_LABEL } from "@/lib/plans";

/** Aperçu tarifaire compact renvoyant vers /tarifs. */
export function PricingPreview() {
  return (
    <section className="border-t border-border py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            Tarifs
          </span>
          <h2 className="mt-3 text-balance text-2xl tracking-tight text-foreground sm:text-3xl">
            Un prix par taille d'entreprise.
          </h2>
          <p className="mt-3 text-pretty text-muted-foreground">
            {TRIAL_DAYS} jours d'essai gratuits, sans engagement. Facturation annuelle : deux mois
            offerts. Prix HT, TVA {VAT_RATE_LABEL} en sus.
          </p>
        </div>

        <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PUBLIC_PLANS.map((p) => (
            <li
              key={p.key}
              className="flex min-w-0 flex-col rounded-xl border border-border bg-card p-5"
            >
              <span className="text-sm font-semibold text-foreground">{p.name}</span>
              <span className="mt-2 text-2xl tracking-tight text-foreground">
                {p.monthly === null ? "Sur devis" : `${formatEur(p.monthly)} HT`}
              </span>
              <span className="mt-1 text-xs text-muted-foreground">
                {p.monthly === null ? "Utilisateurs illimités" : "par mois"}
              </span>
              <span className="mt-3 text-sm text-muted-foreground">
                {p.maxMembers === null
                  ? "Organisation importante"
                  : p.maxMembers === 1
                    ? "1 utilisateur"
                    : `Jusqu'à ${p.maxMembers} utilisateurs`}
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-8">
          <Button size="lg" variant="outline" className="min-h-12 w-full sm:w-auto" asChild>
            <Link to="/tarifs">
              Voir le détail des tarifs <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

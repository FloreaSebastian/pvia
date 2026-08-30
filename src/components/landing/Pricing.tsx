import { Check, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { motion } from "motion/react";
import { Link } from "@tanstack/react-router";
import {
  PUBLIC_PLANS,
  CONTACT_SALES_EMAIL,
  TRIAL_DAYS,
  formatEur,
  formatEurCents,
  vatBreakdown,
  VAT_RATE_LABEL,
  annualSavingPercent,
  type BillingInterval,
} from "@/lib/plans";

export function Pricing({ as = "h2" }: { as?: "h1" | "h2" } = {}) {
  const [interval, setInterval] = useState<BillingInterval>("monthly");
  const Heading = as;

  return (
    <section id="pricing" className="py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-xs font-semibold uppercase tracking-wider text-primary">
            Tarifs
          </span>
          <Heading className="mt-3 text-balance font-display text-3xl font-bold tracking-tight sm:text-4xl">
            Des prix simples, sans surprise
          </Heading>
          <p className="mt-4 text-muted-foreground">
            {TRIAL_DAYS} jours d'essai gratuit, sans carte bancaire. Résiliable à tout moment.
          </p>

          <div
            role="group"
            aria-label="Périodicité de facturation"
            className="mx-auto mt-8 inline-flex rounded-full border border-border bg-muted/40 p-1"
          >
            {(["monthly", "annual"] as const).map((i) => (
              <button
                key={i}
                type="button"
                onClick={() => setInterval(i)}
                aria-pressed={interval === i}
                className={`min-h-[44px] rounded-full px-5 text-sm font-medium transition ${
                  interval === i
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {i === "monthly" ? "Mensuel" : "Annuel"}
                {i === "annual" && (
                  <span className="ml-1.5 text-xs font-semibold text-primary">2 mois offerts</span>
                )}
              </button>
            ))}
          </div>
        </div>

        <h2 className="sr-only">Nos formules d'abonnement</h2>

        <div className="mt-14 grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
          {PUBLIC_PLANS.map((p, i) => {
            const amount = interval === "annual" ? p.annual : p.monthly;
            const saving = annualSavingPercent(p.monthly, p.annual);
            return (
              <motion.div
                key={p.key}
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ duration: 0.45, delay: i * 0.08 }}
                className={`relative flex flex-col rounded-2xl border p-7 ${
                  p.recommended
                    ? "border-primary bg-card shadow-xl shadow-primary/10 ring-1 ring-primary/40"
                    : "border-border bg-card shadow-sm"
                }`}
              >
                {p.recommended && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground shadow-md">
                    Le plus populaire
                  </span>
                )}
                <div>
                  <h3 className="text-lg font-semibold tracking-tight">{p.name}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{p.tagline}</p>
                </div>
                <div className="mt-6 flex flex-wrap items-baseline gap-1">
                  {amount == null ? (
                    <span className="text-3xl font-semibold tracking-tight">Sur devis</span>
                  ) : (
                    <>
                      <span className="text-4xl font-semibold tracking-tight">
                        {formatEur(amount)}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {interval === "annual" ? "/ an HT" : "/ mois HT"}
                      </span>
                    </>
                  )}
                </div>
                {amount != null && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    soit {formatEurCents(vatBreakdown(amount).ttc)} TTC (TVA {VAT_RATE_LABEL})
                  </p>
                )}
                {interval === "annual" && saving != null && (
                  <p className="mt-1 text-xs font-medium text-primary">
                    Soit {saving}% d'économie par rapport au mensuel
                  </p>
                )}
                <ul className="mt-6 flex-1 space-y-3">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
                      <span className="min-w-0 break-words text-foreground/80">{f}</span>
                    </li>
                  ))}
                  {p.notIncluded?.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <X className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
                      <span className="min-w-0 break-words text-muted-foreground">{f}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  size="lg"
                  variant={p.recommended ? "default" : "outline"}
                  className="mt-8 min-h-[44px] w-full"
                  asChild
                >
                  {amount == null ? (
                    <a href={`mailto:${CONTACT_SALES_EMAIL}?subject=Demande%20offre%20Entreprise%20PVIA`}>
                      {p.cta}
                    </a>
                  ) : (
                    <Link to="/signup">{p.cta}</Link>
                  )}
                </Button>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

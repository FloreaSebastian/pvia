import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion } from "motion/react";
import { Link } from "@tanstack/react-router";

const plans = [
  {
    name: "Starter",
    price: "19",
    desc: "Pour les artisans indépendants qui démarrent.",
    features: [
      "Jusqu'à 10 PV par mois",
      "Signature électronique illimitée",
      "Photos et réserves",
      "Export PDF",
      "1 utilisateur",
      "Support email",
    ],
    cta: "Commencer",
  },
  {
    name: "Pro",
    price: "49",
    desc: "Le choix des artisans et petites entreprises actives.",
    features: [
      "PV illimités",
      "Signature électronique eIDAS",
      "Photos illimitées + galerie",
      "Modèles personnalisables",
      "Jusqu'à 5 utilisateurs",
      "Notifications email",
      "Archivage 10 ans",
      "Support prioritaire",
    ],
    cta: "Essayer Pro",
    featured: true,
  },
  {
    name: "Entreprise",
    price: "Sur devis",
    desc: "Pour les sociétés multi-équipes et promoteurs.",
    features: [
      "Tout du plan Pro",
      "Utilisateurs illimités",
      "Multi-sociétés (multi-tenant)",
      "Gestion fine des rôles",
      "API & intégrations",
      "Accompagnement dédié",
      "SLA 99,9%",
    ],
    cta: "Nous contacter",
  },
];

export function Pricing() {
  return (
    <section id="pricing" className="py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-xs font-semibold uppercase tracking-wider text-primary">
            Tarifs
          </span>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Des prix simples, sans surprise
          </h2>
          <p className="mt-4 text-muted-foreground">
            14 jours d'essai gratuit, sans carte bancaire. Résiliable à tout moment.
          </p>
        </div>

        <div className="mt-16 grid gap-6 lg:grid-cols-3">
          {plans.map((p, i) => (
            <motion.div
              key={p.name}
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ duration: 0.45, delay: i * 0.08 }}
              className={`relative flex flex-col rounded-2xl border p-7 ${
                p.featured
                  ? "border-primary bg-card shadow-xl shadow-primary/10 ring-1 ring-primary/40"
                  : "border-border bg-card shadow-sm"
              }`}
            >
              {p.featured && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground shadow-md">
                  Le plus populaire
                </span>
              )}
              <div>
                <h3 className="text-lg font-semibold tracking-tight">{p.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{p.desc}</p>
              </div>
              <div className="mt-6 flex items-baseline gap-1">
                {p.price === "Sur devis" ? (
                  <span className="text-3xl font-semibold tracking-tight">Sur devis</span>
                ) : (
                  <>
                    <span className="text-4xl font-semibold tracking-tight">{p.price}€</span>
                    <span className="text-sm text-muted-foreground">/ mois HT</span>
                  </>
                )}
              </div>
              <ul className="mt-6 flex-1 space-y-3">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm">
                    <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
                    <span className="text-foreground/80">{f}</span>
                  </li>
                ))}
              </ul>
              <Button
                size="lg"
                variant={p.featured ? "default" : "outline"}
                className="mt-8 w-full"
                asChild
              >
                <Link to="/signup">{p.cta}</Link>
              </Button>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

import { motion } from "motion/react";
import { Building2, ListChecks, PenLine, FileCheck2 } from "lucide-react";

const steps = [
  { icon: Building2, title: "Créez le chantier", desc: "Renseignez client, adresse, type de travaux et entreprise.", time: "30 sec" },
  { icon: ListChecks, title: "Ajoutez les travaux réalisés", desc: "Listez prestations, photos et éventuelles réserves.", time: "2 min" },
  { icon: PenLine, title: "Faites signer le client", desc: "Signature électronique sur place, valable juridiquement.", time: "1 min" },
  { icon: FileCheck2, title: "Générez le PDF", desc: "PV automatique, envoi email et archivage sécurisé.", time: "Instantané" },
];

export function HowItWorks() {
  return (
    <section id="demo" className="relative bg-muted/30 py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-xs font-semibold uppercase tracking-wider text-primary">
            Comment ça marche
          </span>
          <h2 className="mt-3 text-balance font-display text-3xl font-bold tracking-tight sm:text-4xl">
            Un PV de réception en 4 étapes
          </h2>
          <p className="mt-4 text-muted-foreground">
            De l'arrivée sur chantier à l'envoi au client, en moins de 5 minutes.
          </p>
        </div>

        <div className="relative mt-16">
          <div
            className="absolute left-1/2 top-0 hidden h-full w-px -translate-x-1/2 bg-gradient-to-b from-transparent via-border to-transparent lg:block"
            aria-hidden
          />
          <div className="grid gap-6 lg:grid-cols-2">
            {steps.map((s, i) => (
              <motion.div
                key={s.title}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ duration: 0.45, delay: i * 0.08 }}
                className={`relative ${i % 2 === 1 ? "lg:mt-24" : ""}`}
              >
                <div className="rounded-2xl border border-border bg-card p-6 shadow-sm transition-all hover:shadow-md">
                  <div className="flex items-center justify-between">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                      <s.icon className="h-5 w-5" />
                    </div>
                    <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                      Étape {i + 1}
                    </span>
                  </div>
                  <h3 className="mt-5 text-lg font-semibold tracking-tight">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.desc}</p>
                  <div className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                    <span className="h-1.5 w-1.5 rounded-full bg-success" /> {s.time}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

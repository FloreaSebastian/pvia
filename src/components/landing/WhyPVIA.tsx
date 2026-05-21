import { motion } from "motion/react";
import { ShieldCheck, Clock, Sparkles, TrendingDown, FileCheck2, Award } from "lucide-react";

const pillars = [
  {
    icon: TrendingDown,
    metric: "−87%",
    title: "Moins de litiges client",
    desc: "Signature électronique horodatée, photos géolocalisées et réserves tracées : votre PV devient une preuve juridique incontestable.",
    accent: "from-rose-500/20 to-orange-500/10",
  },
  {
    icon: Clock,
    metric: "4 min",
    title: "Pour créer un PV complet",
    desc: "Formulaire intelligent, modèles métiers pré-remplis, signature sur place. Fini les soirées à rédiger des PV au bureau.",
    accent: "from-primary/20 to-sky-500/10",
  },
  {
    icon: Award,
    metric: "100%",
    title: "Image pro premium",
    desc: "PDF haut de gamme aux couleurs de votre entreprise, envoyé instantanément au client. Une réception digne d'un grand groupe.",
    accent: "from-emerald-500/20 to-teal-500/10",
  },
];

const proofs = [
  { icon: ShieldCheck, label: "Conforme RGPD & valeur probante eIDAS" },
  { icon: FileCheck2, label: "Archivage légal 10 ans inclus" },
  { icon: Sparkles, label: "Mises à jour & support inclus" },
];

export function WhyPVIA() {
  return (
    <section id="why" className="relative py-24 sm:py-32">
      <div className="absolute inset-x-0 top-0 -z-10 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-primary">
            Pourquoi PVIA ?
          </span>
          <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-4xl lg:text-5xl">
            Moins de litiges. Plus de chantiers.{" "}
            <span className="text-gradient">Une image irréprochable.</span>
          </h2>
          <p className="mt-5 text-pretty text-base text-muted-foreground sm:text-lg">
            PVIA est conçu pour les entreprises du BTP qui veulent sécuriser chaque réception et
            transformer un document administratif en véritable atout commercial.
          </p>
        </div>

        <div className="mt-16 grid gap-6 lg:grid-cols-3">
          {pillars.map((p, i) => (
            <motion.div
              key={p.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.5, delay: i * 0.08 }}
              className="group relative overflow-hidden rounded-2xl border border-border bg-card p-7 shadow-sm transition-all hover:-translate-y-1 hover:border-primary/40 hover:shadow-xl hover:shadow-primary/5"
            >
              <div className={`absolute -right-12 -top-12 h-44 w-44 rounded-full bg-gradient-to-br ${p.accent} blur-2xl transition-opacity group-hover:opacity-100`} />
              <div className="relative">
                <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-foreground/5 text-foreground ring-1 ring-border">
                  <p.icon className="h-5 w-5" />
                </div>
                <div className="mt-6 text-4xl font-bold tracking-tight text-gradient">{p.metric}</div>
                <h3 className="mt-2 text-lg font-semibold tracking-tight">{p.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{p.desc}</p>
              </div>
            </motion.div>
          ))}
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 rounded-2xl border border-border bg-muted/40 p-5">
          {proofs.map((p) => (
            <div key={p.label} className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <p.icon className="h-4 w-4 text-primary" />
              {p.label}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

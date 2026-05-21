import { motion } from "motion/react";
import { Users2, HardHat, PenLine, FileText, Images, AlertTriangle, LayoutDashboard, Bell, Archive } from "lucide-react";

const modules = [
  { icon: Users2, title: "Gestion clients", desc: "Carnet d'adresses complet, historique et facturation." },
  { icon: HardHat, title: "Gestion chantiers", desc: "Suivez l'avancement de chaque chantier en temps réel." },
  { icon: PenLine, title: "Signature électronique", desc: "Signatures tactiles juridiquement valides eIDAS." },
  { icon: FileText, title: "Génération PDF", desc: "Documents professionnels à votre charte." },
  { icon: Images, title: "Galerie photos", desc: "Centralisation des preuves visuelles par chantier." },
  { icon: AlertTriangle, title: "Réserves & SAV", desc: "Levée des réserves suivie jusqu'à clôture." },
  { icon: LayoutDashboard, title: "Tableau de bord", desc: "Statistiques, KPIs et activité d'équipe." },
  { icon: Bell, title: "Notifications email", desc: "Alertes signature, relances et confirmations." },
  { icon: Archive, title: "Archivage légal", desc: "Conservation conforme jusqu'à 10 ans." },
];

export function Modules() {
  return (
    <section id="modules" className="py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-xs font-semibold uppercase tracking-wider text-primary">
            Modules
          </span>
          <h2 className="mt-3 text-balance font-display text-3xl font-bold tracking-tight sm:text-4xl">
            Une suite complète pour piloter votre activité
          </h2>
          <p className="mt-4 text-muted-foreground">
            Tous les outils dont vous avez besoin, dans une seule plateforme.
          </p>
        </div>

        <div className="mt-16 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((m, i) => (
            <motion.div
              key={m.title}
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.35, delay: i * 0.04 }}
              className="group flex gap-4 bg-card p-6 transition-colors hover:bg-muted/40"
            >
              <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-all group-hover:scale-105">
                <m.icon className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold tracking-tight">{m.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{m.desc}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

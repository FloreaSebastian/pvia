import { motion } from "motion/react";
import {
  Zap,
  PenLine,
  Camera,
  AlertTriangle,
  FileDown,
  History,
  Users,
  Smartphone,
  ShieldCheck,
  Mail,
} from "lucide-react";

const features = [
  { icon: Zap, title: "Création rapide de PV", desc: "Formulaire intelligent pré-rempli, vos PV prêts en moins de 5 minutes." },
  { icon: PenLine, title: "Signature électronique", desc: "Signature tactile du client directement sur smartphone ou tablette." },
  { icon: Camera, title: "Photos de chantier", desc: "Ajoutez photos avant/après géolocalisées et horodatées." },
  { icon: AlertTriangle, title: "Gestion des réserves", desc: "Listez et suivez les réserves jusqu'à leur levée définitive." },
  { icon: FileDown, title: "Export PDF automatique", desc: "PV finalisé en PDF haute qualité, prêt à archiver et envoyer." },
  { icon: History, title: "Historique des chantiers", desc: "Tous vos chantiers et documents accessibles en un clic." },
  { icon: Users, title: "Multi-utilisateurs", desc: "Invitez vos équipes, chefs de chantier et gestionnaires." },
  { icon: Smartphone, title: "Compatible mobile terrain", desc: "Interface optimisée pour usage sur chantier, même hors-ligne." },
  { icon: ShieldCheck, title: "Archivage sécurisé", desc: "Stockage chiffré conforme RGPD, conservation 10 ans." },
  { icon: Mail, title: "Envoi automatique", desc: "PV envoyé au client par email avec accusé de réception." },
];

export function Features() {
  return (
    <section id="features" className="relative py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-xs font-semibold uppercase tracking-wider text-primary">
            Fonctionnalités
          </span>
          <h2 className="mt-3 text-balance font-display text-3xl font-bold tracking-tight sm:text-4xl">
            Tout ce qu'il faut pour vos réceptions de travaux
          </h2>
          <p className="mt-4 text-muted-foreground">
            Une plateforme pensée pour le terrain, conçue avec des artisans et entreprises du BTP.
          </p>
        </div>

        <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ duration: 0.4, delay: (i % 5) * 0.05 }}
              className="group relative overflow-hidden rounded-xl border border-border bg-card p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
            >
              <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="text-sm font-semibold tracking-tight">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

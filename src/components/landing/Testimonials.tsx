import { Star } from "lucide-react";
import { motion } from "motion/react";

const reviews = [
  {
    name: "Julien Marchetti",
    role: "Gérant, Rénov'Pro Sud",
    initials: "JM",
    rating: 5,
    text: "Avant je perdais 2 heures à rédiger un PV à la main. Maintenant c'est plié en 5 minutes sur place avec signature client. Mes équipes ont adopté immédiatement.",
  },
  {
    name: "Sophie Lenoir",
    role: "Directrice, SunVolt Énergie",
    initials: "SL",
    rating: 5,
    text: "Pour nos installations photovoltaïques, la traçabilité est essentielle. PVIA nous a permis de structurer notre relation client et de réduire les litiges de moitié.",
  },
  {
    name: "Karim Bensalem",
    role: "Artisan climatisation",
    initials: "KB",
    rating: 5,
    text: "L'interface mobile est parfaite pour le terrain. Photos, réserves, signature, tout y est. Mes clients sont impressionnés par le professionnalisme.",
  },
  {
    name: "Élodie Faure",
    role: "Promoteur, Faure Immobilier",
    initials: "EF",
    rating: 5,
    text: "Gestion centralisée de plus de 80 réceptions par an. L'archivage légal et le suivi des réserves changent la vie de nos chefs de projet.",
  },
  {
    name: "Pierre Dubois",
    role: "Plombier-chauffagiste",
    initials: "PD",
    rating: 5,
    text: "Simple, efficace, exactement ce qu'il fallait. Le PDF généré fait très pro, mes clients règlent plus vite depuis que je l'utilise.",
  },
  {
    name: "Nadia Chevalier",
    role: "Électricienne indépendante",
    initials: "NC",
    rating: 5,
    text: "Excellent rapport qualité/prix. Le service client est réactif et les mises à jour fréquentes. Je recommande à tous mes confrères.",
  },
];

export function Testimonials() {
  return (
    <section id="testimonials" className="bg-muted/30 py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-xs font-semibold uppercase tracking-wider text-primary">
            Avis clients
          </span>
          <h2 className="mt-3 text-balance font-display text-3xl font-bold tracking-tight sm:text-4xl">
            Ils ont transformé leur gestion administrative
          </h2>
          <div className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <div className="flex">
              {[1, 2, 3, 4, 5].map((i) => (
                <Star key={i} className="h-4 w-4 fill-warning text-warning" />
              ))}
            </div>
            <span className="font-medium text-foreground">4.9/5</span>
            <span>· 1 200+ avis</span>
          </div>
        </div>

        <div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {reviews.map((r, i) => (
            <motion.div
              key={r.name}
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ duration: 0.4, delay: (i % 3) * 0.06 }}
              className="rounded-2xl border border-border bg-card p-6 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="flex items-center gap-1">
                {Array.from({ length: r.rating }).map((_, k) => (
                  <Star key={k} className="h-4 w-4 fill-warning text-warning" />
                ))}
              </div>
              <p className="mt-4 text-sm leading-relaxed text-foreground/90">"{r.text}"</p>
              <div className="mt-6 flex items-center gap-3 border-t border-border/70 pt-4">
                <div className="grid h-10 w-10 place-items-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                  {r.initials}
                </div>
                <div>
                  <div className="text-sm font-semibold">{r.name}</div>
                  <div className="text-xs text-muted-foreground">{r.role}</div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

import { motion } from "motion/react";
import { Building2, HardHat, Hammer, Ruler, Wrench, Trees } from "lucide-react";

const orgs = [
  { name: "Toitures du Sud", Icon: Building2 },
  { name: "BTP Aurélien", Icon: HardHat },
  { name: "Charpente Vidal", Icon: Hammer },
  { name: "Atelier Mercier", Icon: Ruler },
  { name: "Solaris Énergie", Icon: Wrench },
  { name: "Verde Paysage", Icon: Trees },
];

export function TrustBar() {
  return (
    <section aria-label="Ils utilisent PVIA" className="border-y border-border/60 bg-muted/30 py-10">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <p className="text-center text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          + 1 200 artisans et entreprises du BTP utilisent PVIA
        </p>
        <div className="mt-6 grid grid-cols-3 items-center gap-x-6 gap-y-4 opacity-70 sm:grid-cols-6">
          {orgs.map(({ name, Icon }, i) => (
            <motion.div
              key={name}
              initial={{ opacity: 0, y: 6 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-30px" }}
              transition={{ duration: 0.4, delay: i * 0.05 }}
              className="flex items-center justify-center gap-2 text-muted-foreground transition hover:opacity-100"
            >
              <Icon className="h-4 w-4" />
              <span className="text-sm font-semibold tracking-tight">{name}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

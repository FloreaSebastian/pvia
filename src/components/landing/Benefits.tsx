import { Clock, FolderKanban, History, Sparkles, Eye, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";

const BENEFITS: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: Clock,
    title: "Du temps administratif",
    text: "Les informations saisies sur le chantier alimentent directement le PV. Pas de ressaisie le soir, pas de photos à retrouver dans la galerie du téléphone.",
  },
  {
    icon: FolderKanban,
    title: "De l'organisation",
    text: "Chaque photo, chaque réserve et chaque document reste rattaché au bon chantier et au bon procès-verbal.",
  },
  {
    icon: History,
    title: "De la traçabilité",
    text: "Qui a créé le PV, qui l'a signé, quand une réserve a été levée : l'historique reste consultable et exportable.",
  },
  {
    icon: Sparkles,
    title: "Du professionnalisme",
    text: "Votre client reçoit un PV clair, à votre image, et suit ses réserves depuis un espace dédié.",
  },
  {
    icon: Eye,
    title: "De la visibilité",
    text: "Vous savez quels PV attendent une signature et quelles réserves restent ouvertes, sans relancer personne.",
  },
  {
    icon: Users,
    title: "De la collaboration",
    text: "Vos équipes travaillent sur la même information, avec des rôles adaptés à chacun.",
  },
];

/** « Ce que vous gagnez » — bénéfices qualitatifs, sans chiffre inventé. */
export function Benefits({ className = "" }: { className?: string }) {
  return (
    <section className={`py-16 sm:py-24 ${className}`}>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            Ce que vous gagnez
          </span>
          <h2 className="mt-3 text-balance text-2xl tracking-tight text-foreground sm:text-3xl">
            Ce que PVIA change dans votre semaine.
          </h2>
          <p className="mt-3 text-pretty text-muted-foreground">
            Pas de promesse chiffrée : simplement une manière de travailler plus structurée.
          </p>
        </div>

        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {BENEFITS.map((b) => (
            <li
              key={b.title}
              className="min-w-0 rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/40"
            >
              <b.icon aria-hidden className="h-5 w-5 text-primary" />
              <h3 className="mt-3 text-base font-semibold text-foreground">{b.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{b.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

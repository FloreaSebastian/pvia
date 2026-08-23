import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

export const PRODUCT_PAGES = [
  {
    to: "/fonctionnalites",
    label: "Fonctionnalités",
    desc: "Tout ce que PVIA couvre, du chantier au PDF signé.",
  },
  {
    to: "/solutions/pv-reception",
    label: "PV de réception",
    desc: "Créer, faire signer et envoyer un procès-verbal.",
  },
  {
    to: "/solutions/reserves",
    label: "Gestion des réserves",
    desc: "Ouverture, gravité, levée et validation client.",
  },
  {
    to: "/solutions/terrain",
    label: "Mode terrain",
    desc: "Photos, réserves et signature depuis le téléphone.",
  },
  {
    to: "/solutions/planning",
    label: "Planning chantier",
    desc: "Interventions, équipes et réceptions planifiées.",
  },
  {
    to: "/solutions/espace-client",
    label: "Espace client",
    desc: "Vos clients consultent, signent et valident.",
  },
  {
    to: "/comment-ca-marche",
    label: "Comment ça marche",
    desc: "Le déroulé complet d'une réception, étape par étape.",
  },
  {
    to: "/solutions",
    label: "Solutions métiers",
    desc: "Photovoltaïque, CVC, électricité, rénovation…",
  },
] as const;

/** Maillage interne entre les pages produit. */
export function ProductLinks({ currentTo }: { currentTo?: string }) {
  const items = PRODUCT_PAGES.filter((p) => p.to !== currentTo);
  return (
    <section className="border-t border-border py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <h2 className="text-2xl tracking-tight text-foreground sm:text-3xl">Explorer PVIA</h2>
        <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((p) => (
            <li key={p.to}>
              <Link
                to={p.to}
                className="group flex min-h-[6rem] min-w-0 flex-col justify-between rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/50"
              >
                <span className="flex items-center justify-between gap-2 text-sm font-semibold text-foreground">
                  <span className="truncate">{p.label}</span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </span>
                <span className="mt-2 text-sm text-muted-foreground">{p.desc}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

import { Link } from "@tanstack/react-router";
import { Mail } from "lucide-react";
import { Logo } from "@/components/landing/Logo";

type LinkDef = { label: string; href: string; internal?: boolean };

const columns: { title: string; links: LinkDef[] }[] = [
  {
    title: "Produit",
    links: [
      { label: "Fonctionnalités", href: "/fonctionnalites", internal: true },
      { label: "PV de réception", href: "/solutions/pv-reception", internal: true },
      { label: "Gestion des réserves", href: "/solutions/reserves", internal: true },
      { label: "Mode terrain", href: "/solutions/terrain", internal: true },
      { label: "Planning chantier", href: "/solutions/planning", internal: true },
      { label: "Espace client", href: "/solutions/espace-client", internal: true },
    ],
  },
  {
    title: "Solutions",
    links: [
      { label: "Photovoltaïque", href: "/solutions/photovoltaique", internal: true },
      { label: "Climatisation & PAC", href: "/solutions/climatisation", internal: true },
      { label: "Électricité", href: "/solutions/electricite", internal: true },
      { label: "Plomberie", href: "/solutions/plomberie", internal: true },
      { label: "Rénovation", href: "/solutions/renovation", internal: true },
      { label: "Construction", href: "/solutions/construction", internal: true },
    ],
  },
  {
    title: "Entreprise",
    links: [
      { label: "Pourquoi PVIA ?", href: "/pourquoi-pvia", internal: true },
      { label: "Comment ça marche", href: "/comment-ca-marche", internal: true },
      { label: "Tarifs", href: "/tarifs", internal: true },
      { label: "Contact", href: "/contact", internal: true },
      { label: "Sécurité", href: "/securite", internal: true },
    ],
  },
  {
    title: "Accès & légal",
    links: [
      { label: "Connexion", href: "/login", internal: true },
      { label: "Espace client", href: "/login?type=client", internal: true },
      { label: "CGV", href: "/cgv", internal: true },
      { label: "Politique de confidentialité", href: "/confidentialite", internal: true },
      { label: "Mentions légales", href: "/mentions", internal: true },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-6">
          <div className="min-w-0 lg:col-span-2">
            <Logo />
            <p className="mt-4 max-w-sm text-sm text-muted-foreground">
              PVIA — Réception de travaux intelligente. Procès-verbaux, réserves, photos et
              signatures, du chantier au PDF signé.
            </p>
            <a
              href="mailto:contact@pvia.fr"
              className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm text-foreground hover:text-primary"
            >
              <Mail className="h-4 w-4" />
              <span>contact@pvia.fr</span>
            </a>
          </div>

          {columns.map((c) => (
            <nav key={c.title} aria-label={c.title} className="min-w-0">
              <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-foreground">
                {c.title}
              </h2>
              <ul className="mt-4 space-y-1">
                {c.links.map((l) => (
                  <li key={l.label}>
                    {l.internal ? (
                      <Link
                        to={l.href}
                        className="flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground"
                      >
                        {l.label}
                      </Link>
                    ) : (
                      <a
                        href={l.href}
                        className="flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground"
                      >
                        {l.label}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-10 border-t border-border pt-6">
          <p className="text-xs text-muted-foreground">© 2026 PVIA — Tous droits réservés.</p>
        </div>
      </div>
    </footer>
  );
}

import { Link } from "@tanstack/react-router";
import { Mail } from "lucide-react";
import { Logo } from "@/components/landing/Logo";

type LinkDef = { label: string; href: string; internal?: boolean };

const columns: { title: string; links: LinkDef[] }[] = [
  {
    title: "PVIA",
    links: [
      { label: "Fonctionnalités", href: "/#fonctionnalites" },
      { label: "Tarifs", href: "/tarifs", internal: true },
      { label: "Connexion", href: "/login", internal: true },
    ],
  },
  {
    title: "Produit",
    links: [
      { label: "Réception", href: "/#comment-ca-marche" },
      { label: "Réserves", href: "/#reserves" },
      { label: "Mode terrain", href: "/#mode-terrain" },
      { label: "Espace client", href: "/#espace-client" },
    ],
  },
  {
    title: "Entreprise",
    links: [
      { label: "Contact", href: "mailto:contact@pvia.fr" },
      { label: "Sécurité", href: "/securite", internal: true },
      { label: "Espace client", href: "/client/login", internal: true },
    ],
  },
  {
    title: "Légal",
    links: [
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

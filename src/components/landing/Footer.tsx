import { Linkedin, Twitter, Facebook, Mail } from "lucide-react";
import { Logo } from "@/components/landing/Logo";

export function Footer() {
  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <Logo withBaseline />
            <p className="mt-4 max-w-sm text-sm text-muted-foreground">
              La solution professionnelle pour créer, signer et archiver vos procès-verbaux de
              réception de travaux.
            </p>
            <a
              href="mailto:contact@pvia.fr"
              className="mt-4 inline-flex items-center gap-2 text-sm text-foreground hover:text-primary"
            >
              <Mail className="h-4 w-4" /><span>contact@pvia.fr</span>
            </a>
          </div>

          <FooterCol
            title="Produit"
            links={[
              ["Fonctionnalités", "/#features"],
              ["Tarifs", "/tarifs"],
              ["Sécurité", "/securite"],
              ["Avis clients", "/#testimonials"],
            ]}
          />
          <FooterCol
            title="Entreprise"
            links={[
              ["Contact", "mailto:contact@pvia.fr"],
              ["Connexion", "/login"],
              ["Essai gratuit", "/signup"],
              ["Espace client", "/client/login"],
            ]}
          />
          <FooterCol
            title="Légal"
            links={[
              ["Mentions légales", "/mentions"],
              ["CGV", "/cgv"],
              ["Confidentialité", "/confidentialite"],
              ["Sécurité & RGPD", "/securite"],
            ]}
          />
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-border pt-8 sm:flex-row">
          <p className="text-xs text-muted-foreground">
            © 2026 PVIA — Tous droits réservés.
          </p>
          <div className="flex items-center gap-3">
            {[Linkedin, Twitter, Facebook].map((Icon, i) => (
              <a
                key={i}
                href="#"
                className="grid h-8 w-8 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                aria-label="Social link"
              >
                <Icon className="h-4 w-4" />
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground">{title}</h4>
      <ul className="mt-4 space-y-2.5">
        {links.map(([label, href]) => (
          <li key={label}>
            <a href={href} className="text-sm text-muted-foreground hover:text-foreground">
              {label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

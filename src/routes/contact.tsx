import { createFileRoute, Link } from "@tanstack/react-router";
import { Mail, LifeBuoy, Building2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/landing/Header";
import { Footer } from "@/components/landing/Footer";
import { CONTACT_SALES_EMAIL, TRIAL_DAYS } from "@/lib/plans";

const TITLE = "Contacter PVIA — questions, démonstration, offre Entreprise";
const DESCRIPTION =
  "Une question sur PVIA, une demande de démonstration ou un besoin spécifique pour votre entreprise ? Écrivez-nous, nous répondons par email.";

export const Route = createFileRoute("/contact")({
  component: ContactPage,
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://pvia.fr/contact" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESCRIPTION },
    ],
    links: [{ rel: "canonical", href: "https://pvia.fr/contact" }],
  }),
});

const CARDS = [
  {
    icon: Building2,
    title: "Offre Entreprise",
    text: "Utilisateurs illimités, besoins spécifiques, déploiement accompagné : décrivez votre organisation, nous revenons vers vous avec une proposition.",
    subject: "Offre Entreprise PVIA",
  },
  {
    icon: LifeBuoy,
    title: "Question sur le produit",
    text: "Vous voulez savoir si PVIA correspond à votre manière de réceptionner vos chantiers ? Posez la question, nous répondons précisément.",
    subject: "Question sur PVIA",
  },
  {
    icon: Mail,
    title: "Démonstration",
    text: "Nous pouvons vous montrer le déroulé complet d'une réception, de la création du chantier au PV signé.",
    subject: "Demande de démonstration PVIA",
  },
];

function ContactPage() {
  return (
    <div className="landing-editorial min-h-screen bg-background">
      <Header />
      <main>
        <section className="relative overflow-hidden pt-28 sm:pt-36">
          <div aria-hidden className="absolute inset-x-0 top-0 -z-10 h-[420px] bg-radial-fade" />
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                Contact
              </span>
              <h1 className="mt-3 text-balance text-[clamp(2rem,6vw,3.5rem)] tracking-tight text-foreground">
                Parlons de vos chantiers.
              </h1>
              <p className="mt-5 max-w-2xl text-pretty text-base text-muted-foreground sm:text-lg">
                Vous pouvez commencer l'essai sans nous contacter : {TRIAL_DAYS} jours gratuits,
                sans engagement. Pour tout le reste, écrivez-nous.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button size="lg" className="min-h-12 w-full sm:w-auto" asChild>
                  <a href={`mailto:${CONTACT_SALES_EMAIL}`}>
                    Écrire à {CONTACT_SALES_EMAIL} <ArrowRight className="ml-1 h-4 w-4" />
                  </a>
                </Button>
                <Button size="lg" variant="outline" className="min-h-12 w-full sm:w-auto" asChild>
                  <Link to="/signup">Commencer l'essai</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        <section className="py-16 sm:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {CARDS.map((c) => (
                <li key={c.title} className="min-w-0 rounded-xl border border-border bg-card p-5">
                  <c.icon aria-hidden className="h-5 w-5 text-primary" />
                  <h2 className="mt-3 text-base font-semibold text-foreground">{c.title}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{c.text}</p>
                  <a
                    href={`mailto:${CONTACT_SALES_EMAIL}?subject=${encodeURIComponent(c.subject)}`}
                    className="mt-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                  >
                    Nous écrire <ArrowRight aria-hidden className="h-4 w-4" />
                  </a>
                </li>
              ))}
            </ul>

            <div className="mt-10 rounded-xl border border-border bg-muted/40 p-5">
              <h2 className="text-base font-semibold text-foreground">Déjà client ?</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Vos clients accèdent à leurs procès-verbaux depuis l'
                <Link to="/client/login" className="text-primary hover:underline">
                  espace client
                </Link>
                . Votre équipe se connecte depuis la{" "}
                <Link to="/login" className="text-primary hover:underline">
                  page de connexion
                </Link>
                .
              </p>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

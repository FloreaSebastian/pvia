import { createFileRoute } from "@tanstack/react-router";
import { MarketingPage } from "@/components/landing/MarketingPage";
import { Workflow } from "@/components/landing/Workflow";
import { Benefits } from "@/components/landing/Benefits";
import { ProductLinks } from "@/components/landing/ProductLinks";
import { DashboardMockup } from "@/components/landing/mockups";

const TITLE = "Pourquoi PVIA — avant / après pour la réception de travaux";
const DESCRIPTION =
  "Photos dans le téléphone, réserves par message, PV à retaper, signature à récupérer : voici ce que PVIA remplace, et ce que vous y gagnez concrètement.";

const BEFORE = [
  "Les photos restent dans la galerie du téléphone du technicien.",
  "Les réserves circulent par message et personne ne sait ce qui reste ouvert.",
  "Le PV est retapé le soir, à partir de notes.",
  "La signature du client se court après pendant plusieurs jours.",
  "Le PDF final se cherche dans une boîte mail six mois plus tard.",
  "Le client rappelle pour savoir où en est sa reprise.",
];

const AFTER = [
  "Les photos sont prises depuis PVIA et rattachées au chantier.",
  "Chaque réserve a une gravité, un responsable et un état visible.",
  "Le PV se remplit pendant la visite, pas après.",
  "Le client signe sur place, ou à distance par email avec code.",
  "Le PDF signé reste dans le chantier et dans l'espace client.",
  "Le client suit lui-même l'avancement de ses réserves.",
];

export const Route = createFileRoute("/pourquoi-pvia")({
  component: Page,
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://pvia.fr/pourquoi-pvia" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESCRIPTION },
    ],
    links: [{ rel: "canonical", href: "https://pvia.fr/pourquoi-pvia" }],
  }),
});

function Page() {
  return (
    <MarketingPage
      eyebrow="Pourquoi PVIA"
      title="Voilà comment vous travaillez aujourd'hui. Voilà comment vous pouvez travailler."
      description="PVIA ne remplace pas votre métier : il remplace le travail administratif qui vient après le chantier, et la recherche d'informations qui vient des mois plus tard."
      bullets={["Moins de ressaisie", "Moins d'informations perdues", "Une réception plus nette"]}
      visual={<DashboardMockup />}
    >
      <section className="py-16 sm:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-6 lg:grid-cols-2 lg:gap-10">
            <div className="min-w-0 rounded-2xl border border-border bg-muted/40 p-6">
              <h2 className="text-xl tracking-tight text-foreground sm:text-2xl">Sans PVIA</h2>
              <ul className="mt-5 space-y-3">
                {BEFORE.map((b) => (
                  <li key={b} className="min-w-0 text-sm leading-relaxed text-muted-foreground">
                    {b}
                  </li>
                ))}
              </ul>
            </div>
            <div className="min-w-0 rounded-2xl border border-primary/30 bg-card p-6">
              <h2 className="text-xl tracking-tight text-foreground sm:text-2xl">Avec PVIA</h2>
              <ul className="mt-5 space-y-3">
                {AFTER.map((a) => (
                  <li key={a} className="min-w-0 text-sm leading-relaxed text-foreground">
                    {a}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p className="mt-8 max-w-2xl text-sm text-muted-foreground">
            Nous ne publions pas de gains chiffrés tant que nous n'avons pas de mesure réelle à
            partager. Ce que nous décrivons ici correspond à ce que le logiciel fait aujourd'hui.
          </p>
        </div>
      </section>

      <Workflow />
      <Benefits />
      <ProductLinks currentTo="/pourquoi-pvia" />
    </MarketingPage>
  );
}

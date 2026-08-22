import { createFileRoute } from "@tanstack/react-router";
import { MarketingPage } from "@/components/landing/MarketingPage";
import { FeatureBlocks } from "@/components/landing/FeatureBlock";
import { ProductLinks } from "@/components/landing/ProductLinks";
import { CalendarMockup, DashboardMockup } from "@/components/landing/mockups";

const TITLE = "Planning de chantier et interventions — PVIA";
const DESCRIPTION =
  "Planifiez vos interventions et vos réceptions, affectez vos équipes et gardez le chantier dans le même outil jusqu'à son PV signé. Vues jour, semaine et mois.";

export const Route = createFileRoute("/planning-chantier")({
  component: Page,
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://pvia.fr/planning-chantier" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESCRIPTION },
    ],
    links: [{ rel: "canonical", href: "https://pvia.fr/planning-chantier" }],
  }),
});

function Page() {
  return (
    <MarketingPage
      eyebrow="Planning"
      title="Planifiez l'intervention, gardez le chantier jusqu'à sa réception."
      description="Le calendrier PVIA rassemble interventions, réceptions et équipes. Le chantier planifié est le même que celui qui sera réceptionné : aucune double saisie entre les deux."
      bullets={["Vues jour, semaine, mois", "Équipes et techniciens", "Événements de chantier"]}
      ctaLabel="Découvrir PVIA"
      visual={<CalendarMockup />}
    >
      <FeatureBlocks
        title="Un calendrier pensé pour le chantier"
        items={[
          {
            eyebrow: "Vues",
            title: "Du jour à la vue mensuelle",
            problem:
              "Un tableur partagé ne montre ni la charge de la semaine, ni ce qui tombe le même jour.",
            solution:
              "Le calendrier propose une vue jour, plusieurs jours, semaine et mois, avec un mode plein écran sur les grands écrans comme sur mobile.",
            benefit: "Vous voyez immédiatement les journées chargées et les créneaux disponibles.",
            visual: <CalendarMockup />,
          },
          {
            eyebrow: "Équipes",
            title: "Chaque intervention a son équipe",
            problem:
              "Savoir qui est sur quel chantier demande souvent un appel ou un message.",
            solution:
              "Vous affectez les techniciens aux interventions et filtrez le calendrier par équipe ou par chantier.",
            benefit: "L'information d'affectation est au même endroit que le chantier lui-même.",
          },
          {
            eyebrow: "Continuité",
            title: "Du créneau planifié au PV signé",
            problem:
              "Le planning vit d'un côté, la réception de l'autre, et l'information se recopie.",
            solution:
              "L'intervention est rattachée au chantier : les photos, les réserves et le procès-verbal viennent s'y greffer.",
            benefit:
              "Le dossier du chantier se construit tout seul, du premier rendez-vous à l'historique final.",
            visual: <DashboardMockup />,
          },
        ]}
      />

      <ProductLinks currentTo="/planning-chantier" />
    </MarketingPage>
  );
}

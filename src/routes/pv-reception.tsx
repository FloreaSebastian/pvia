import { createFileRoute } from "@tanstack/react-router";
import { MarketingPage } from "@/components/landing/MarketingPage";
import { FeatureBlocks } from "@/components/landing/FeatureBlock";
import { Workflow } from "@/components/landing/Workflow";
import { ProductLinks } from "@/components/landing/ProductLinks";
import {
  DashboardMockup,
  PhoneMockup,
  ReserveMockup,
  SignatureMockup,
} from "@/components/landing/mockups";

const TITLE = "PV de réception numérique — créer et faire signer | PVIA";
const DESCRIPTION =
  "Créez un procès-verbal de réception depuis le chantier : informations, photos, réserves, signature du client sur place et envoi du PDF. PVIA garde tout l'historique.";

export const Route = createFileRoute("/pv-reception")({
  component: Page,
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://pvia.fr/pv-reception" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESCRIPTION },
    ],
    links: [{ rel: "canonical", href: "https://pvia.fr/pv-reception" }],
  }),
});

function Page() {
  return (
    <MarketingPage
      eyebrow="PV de réception"
      title="Le PV de réception, sans la paperasse."
      description="Le chantier est terminé : le procès-verbal se remplit sur place, se signe sur place et part au client avant que vous ne repreniez la route."
      bullets={["Création guidée", "Photos", "Réserves", "Signature", "PDF", "Historique"]}
      ctaLabel="Créer mon premier PV"
      visual={<DashboardMockup />}
    >
      <Workflow
        title="Un PV, c'est une chaîne d'étapes. PVIA les tient toutes."
        description="Chaque étape alimente la suivante : rien n'est ressaisi, rien n'est perdu."
      />

      <FeatureBlocks
        title="Comment se déroule un PV dans PVIA"
        description="Le déroulé correspond à votre visite de réception, pas à un formulaire administratif."
        items={[
          {
            eyebrow: "Création",
            title: "Le PV part du chantier, pas d'une page blanche",
            problem:
              "Recréer à chaque fois l'en-tête, le client, l'adresse et les intervenants prend du temps et laisse passer des erreurs.",
            solution:
              "Vous sélectionnez le chantier et son client : les informations, la référence et la numérotation du PV sont reprises automatiquement.",
            benefit:
              "Vous commencez la visite au lieu de commencer une saisie, et deux PV ne peuvent pas se contredire.",
            visual: <DashboardMockup />,
          },
          {
            eyebrow: "Photos et réserves",
            title: "Ce que vous constatez est enregistré sur place",
            problem:
              "Les photos restent dans la galerie du téléphone et les points à reprendre partent dans une conversation.",
            solution:
              "Vous prenez la photo depuis PVIA et créez la réserve avec sa gravité et son responsable, rattachées au PV.",
            benefit:
              "Le soir, il n'y a plus rien à reconstituer : le PV est déjà complet.",
            visual: (
              <div className="flex justify-center">
                <PhoneMockup />
              </div>
            ),
          },
          {
            eyebrow: "Signature",
            title: "Le client signe pendant qu'il est encore là",
            problem:
              "Une signature récupérée plusieurs jours plus tard, c'est des relances, des allers-retours et parfois un litige.",
            solution:
              "Le client signe directement sur votre appareil. La signature à distance par email avec code de vérification est disponible selon la formule.",
            benefit:
              "La réception est close le jour même, avec une preuve de signature horodatée.",
            visual: <SignatureMockup />,
          },
          {
            eyebrow: "PDF et suite",
            title: "Le PDF part, les réserves continuent d'être suivies",
            problem:
              "Le document envoyé fige la situation : les reprises restantes ne sont plus visibles nulle part.",
            solution:
              "Le PDF signé est envoyé au client et déposé dans son espace, tandis que les réserves restent ouvertes jusqu'à leur levée puis leur validation.",
            benefit:
              "Vous savez à tout moment où en est chaque chantier après sa réception.",
            visual: <ReserveMockup />,
          },
        ]}
      />

      <ProductLinks currentTo="/pv-reception" />
    </MarketingPage>
  );
}

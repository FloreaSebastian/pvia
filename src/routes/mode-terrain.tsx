import { createFileRoute } from "@tanstack/react-router";
import { MarketingPage } from "@/components/landing/MarketingPage";
import { ProductLinks } from "@/components/landing/ProductLinks";
import { FieldMode } from "@/components/landing/FieldMode";
import { TradesBar } from "@/components/landing/TradesBar";
import { PlanningTeam } from "@/components/landing/PlanningTeam";

const TITLE = "Mode terrain PVIA — Le PV depuis le téléphone";
const DESCRIPTION =
  "Photos, réserves, adresse du chantier et signature du client directement sur le téléphone : PVIA est pensé pour être utilisé sur le chantier, pas au bureau.";

export const Route = createFileRoute("/mode-terrain")({
  component: Page,
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://pvia.fr/mode-terrain" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESCRIPTION },
    ],
    links: [{ rel: "canonical", href: "https://pvia.fr/mode-terrain" }],
  }),
});

function Page() {
  return (
    <MarketingPage
      eyebrow="Mode terrain"
      title="Le chantier d'abord, le bureau ensuite."
      description="PVIA s'utilise depuis le téléphone : photos rattachées au PV, réserves créées en quelques secondes, signature du client sur place."
      bullets={["Photos", "Réserves rapides", "Signature sur place", "Interface mobile"]}
    >
      <FieldMode />
      <TradesBar />
      <PlanningTeam />
      <ProductLinks currentTo="/mode-terrain" />
    </MarketingPage>
  );
}

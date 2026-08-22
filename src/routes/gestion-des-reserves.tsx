import { createFileRoute } from "@tanstack/react-router";
import { MarketingPage } from "@/components/landing/MarketingPage";
import { ProductLinks } from "@/components/landing/ProductLinks";
import { Reserves } from "@/components/landing/Reserves";
import { ClientSpace } from "@/components/landing/ClientSpace";
import { Pilotage } from "@/components/landing/Pilotage";

const TITLE = "Gestion des réserves de chantier — PVIA";
const DESCRIPTION =
  "Suivez chaque réserve de chantier avec PVIA : gravité, responsable, statut, photos avant/après, levée sur le terrain et validation par le client.";

export const Route = createFileRoute("/gestion-des-reserves")({
  component: Page,
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://pvia.fr/gestion-des-reserves" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESCRIPTION },
    ],
    links: [{ rel: "canonical", href: "https://pvia.fr/gestion-des-reserves" }],
  }),
});

function Page() {
  return (
    <MarketingPage
      eyebrow="Réserves"
      title="Chaque réserve a un responsable, une preuve et une fin."
      description="De l'ouverture à la validation du client, PVIA garde la trace : gravité, statut, photos avant/après et historique complet."
      bullets={["Gravité", "Responsable", "Photos avant/après", "Validation client"]}
    >
      <Reserves />
      <ClientSpace />
      <Pilotage />
      <ProductLinks currentTo="/gestion-des-reserves" />
    </MarketingPage>
  );
}

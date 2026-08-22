import { createFileRoute } from "@tanstack/react-router";
import { MarketingPage } from "@/components/landing/MarketingPage";
import { ProductLinks } from "@/components/landing/ProductLinks";
import { Features } from "@/components/landing/Features";
import { SignaturePdf } from "@/components/landing/SignaturePdf";
import { Pilotage } from "@/components/landing/Pilotage";
import { PlanningTeam } from "@/components/landing/PlanningTeam";

const TITLE = "Fonctionnalités PVIA — PV, réserves, photos et signature";
const DESCRIPTION =
  "Découvrez les fonctionnalités de PVIA : procès-verbaux de réception, réserves, photos avant/après, signature électronique, PDF automatique, planning et espace client.";

export const Route = createFileRoute("/fonctionnalites")({
  component: Page,
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://pvia.fr/fonctionnalites" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESCRIPTION },
    ],
    links: [{ rel: "canonical", href: "https://pvia.fr/fonctionnalites" }],
  }),
});

function Page() {
  return (
    <MarketingPage
      eyebrow="Fonctionnalités"
      title="Un seul logiciel, du premier chantier au PV signé."
      description="PVIA réunit la réception de travaux, les réserves, les photos, la signature et le suivi d'activité. Pas de tableur, pas de dossier photo perdu."
      bullets={["PV de réception", "Réserves tracées", "Signature électronique", "PDF automatique"]}
    >
      <Features />
      <SignaturePdf />
      <PlanningTeam />
      <Pilotage />
      <ProductLinks currentTo="/fonctionnalites" />
    </MarketingPage>
  );
}

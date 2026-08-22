import { createFileRoute } from "@tanstack/react-router";
import { MarketingPage } from "@/components/landing/MarketingPage";
import { ProductLinks } from "@/components/landing/ProductLinks";
import { ProblemSolution } from "@/components/landing/ProblemSolution";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { SignaturePdf } from "@/components/landing/SignaturePdf";

const TITLE = "Comment ça marche — Réception de travaux avec PVIA";
const DESCRIPTION =
  "Le déroulé complet d'une réception avec PVIA : création du chantier, constat sur le terrain, réserves, signature du client et PDF envoyé automatiquement.";

export const Route = createFileRoute("/comment-ca-marche")({
  component: Page,
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://pvia.fr/comment-ca-marche" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESCRIPTION },
    ],
    links: [{ rel: "canonical", href: "https://pvia.fr/comment-ca-marche" }],
  }),
});

function Page() {
  return (
    <MarketingPage
      eyebrow="Comment ça marche"
      title="Une réception se termine sur le chantier, pas au bureau."
      description="Créez le chantier, constatez sur place, faites signer, envoyez le PDF. PVIA suit ensuite chaque réserve jusqu'à sa levée."
      bullets={["3 étapes", "Signature sur place", "PDF envoyé", "Suivi des levées"]}
    >
      <ProblemSolution />
      <HowItWorks />
      <SignaturePdf />
      <ProductLinks currentTo="/comment-ca-marche" />
    </MarketingPage>
  );
}

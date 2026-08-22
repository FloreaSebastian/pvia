import { createFileRoute } from "@tanstack/react-router";
import { MarketingPage } from "@/components/landing/MarketingPage";
import { ProductLinks } from "@/components/landing/ProductLinks";
import { ClientSpace } from "@/components/landing/ClientSpace";
import { SignaturePdf } from "@/components/landing/SignaturePdf";

const TITLE = "Espace client PVIA — Signature et suivi pour vos clients";
const DESCRIPTION =
  "Vos clients consultent leurs procès-verbaux, signent, téléchargent le PDF et valident les levées de réserves depuis un espace dédié, sans créer de compte compliqué.";

export const Route = createFileRoute("/espace-client")({
  component: Page,
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://pvia.fr/espace-client" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESCRIPTION },
    ],
    links: [{ rel: "canonical", href: "https://pvia.fr/espace-client" }],
  }),
});

function Page() {
  return (
    <MarketingPage
      eyebrow="Espace client"
      title="Vos clients suivent leurs documents, sans vous relancer."
      description="Consultation des PV, signature à distance, téléchargement du PDF et validation des levées de réserves : tout est réuni dans un espace dédié."
      bullets={["Consultation", "Signature à distance", "PDF", "Validation des levées"]}
    >
      <ClientSpace />
      <SignaturePdf />
      <ProductLinks currentTo="/espace-client" />
    </MarketingPage>
  );
}

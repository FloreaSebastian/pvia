import { createFileRoute } from "@tanstack/react-router";
import { Header } from "@/components/landing/Header";
import { Hero } from "@/components/landing/Hero";
import { TradesBar } from "@/components/landing/TradesBar";
import { ProblemSolution } from "@/components/landing/ProblemSolution";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { FieldMode } from "@/components/landing/FieldMode";
import { Reserves } from "@/components/landing/Reserves";
import { SignaturePdf } from "@/components/landing/SignaturePdf";
import { ClientSpace } from "@/components/landing/ClientSpace";
import { PlanningTeam } from "@/components/landing/PlanningTeam";
import { Pilotage } from "@/components/landing/Pilotage";
import { Features } from "@/components/landing/Features";
import { Pricing } from "@/components/landing/Pricing";
import { FAQ, faqs } from "@/components/landing/FAQ";
import { CTA } from "@/components/landing/CTA";
import { Footer } from "@/components/landing/Footer";

const TITLE = "PVIA — Logiciel de réception de travaux et gestion des réserves";
const DESCRIPTION =
  "PVIA centralise vos PV de réception, réserves chantier, photos et signatures. Créez, faites signer et envoyez un PV professionnel depuis le chantier, suivez chaque levée de réserve.";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { name: "robots", content: "index, follow" },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://pvia.fr/" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESCRIPTION },
    ],
    links: [{ rel: "canonical", href: "https://pvia.fr/" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "PVIA",
          applicationCategory: "BusinessApplication",
          operatingSystem: "Web, iOS, Android",
          description: DESCRIPTION,
          offers: {
            "@type": "Offer",
            price: "19",
            priceCurrency: "EUR",
            description: "À partir de 19 € HT/mois. 14 jours d'essai gratuits, sans engagement.",
          },
          publisher: { "@type": "Organization", name: "PVIA", url: "https://pvia.fr" },
        }),
      },
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: faqs.map((f) => ({
            "@type": "Question",
            name: f.q,
            acceptedAnswer: { "@type": "Answer", text: f.a },
          })),
        }),
      },
    ],
  }),
});

function Index() {
  return (
    <div className="landing-editorial min-h-screen bg-background">
      <Header />
      <main>
        <Hero />
        <TradesBar />
        <ProblemSolution />
        <HowItWorks />
        <Features />
        <ProductLinks />
        <Pricing />
        <FAQ />
        <CTA />
      </main>
      <Footer />
    </div>
  );
}

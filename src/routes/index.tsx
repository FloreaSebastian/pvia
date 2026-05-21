import { createFileRoute } from "@tanstack/react-router";
import { Header } from "@/components/landing/Header";
import { Hero } from "@/components/landing/Hero";
import { WhyPVIA } from "@/components/landing/WhyPVIA";
import { Features } from "@/components/landing/Features";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { Modules } from "@/components/landing/Modules";
import { Stats } from "@/components/landing/Stats";
import { Testimonials } from "@/components/landing/Testimonials";
import { Pricing } from "@/components/landing/Pricing";
import { FAQ } from "@/components/landing/FAQ";
import { CTA } from "@/components/landing/CTA";
import { Footer } from "@/components/landing/Footer";
import { StickyCTA } from "@/components/landing/StickyCTA";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "PVIA — Procès-verbaux de réception de travaux pour le BTP" },
      {
        name: "description",
        content:
          "Créez, signez et envoyez vos procès-verbaux de réception en quelques minutes. Photos, réserves, signature électronique et PDF automatique pour les pros du BTP.",
      },
      { property: "og:title", content: "PVIA — PV de réception simple et professionnel" },
      {
        property: "og:description",
        content:
          "La solution SaaS pour digitaliser vos réceptions de travaux : signature électronique, photos, réserves, PDF automatique.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://pvia.fr/" },
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
          description:
            "PVIA digitalise vos procès-verbaux de réception de travaux : signature électronique, photos, réserves et PDF automatique.",
          offers: {
            "@type": "Offer",
            price: "0",
            priceCurrency: "EUR",
            description: "Essai gratuit 14 jours, sans carte bancaire.",
          },
          publisher: { "@type": "Organization", name: "PVIA", url: "https://pvia.fr" },
        }),
      },
    ],
  }),
});

function Index() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main>
        <Hero />
        <WhyPVIA />
        <Features />
        <HowItWorks />
        <Modules />
        <Stats />
        <Testimonials />
        <Pricing />
        <FAQ />
        <CTA />
      </main>
      <Footer />
      <StickyCTA />
    </div>
  );
}

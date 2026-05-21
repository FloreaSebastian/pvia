import { createFileRoute } from "@tanstack/react-router";
import { Header } from "@/components/landing/Header";
import { Hero } from "@/components/landing/Hero";
import { Features } from "@/components/landing/Features";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { Modules } from "@/components/landing/Modules";
import { Stats } from "@/components/landing/Stats";
import { Testimonials } from "@/components/landing/Testimonials";
import { Pricing } from "@/components/landing/Pricing";
import { FAQ } from "@/components/landing/FAQ";
import { CTA } from "@/components/landing/CTA";
import { Footer } from "@/components/landing/Footer";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      {
        title: "PVIA — Procès-verbaux de réception de travaux pour le BTP",
      },
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
    ],
    links: [{ rel: "canonical", href: "/" }],
  }),
});

function Index() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main>
        <Hero />
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
    </div>
  );
}

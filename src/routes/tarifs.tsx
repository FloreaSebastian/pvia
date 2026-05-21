import { createFileRoute } from "@tanstack/react-router";
import { Header } from "@/components/landing/Header";
import { Footer } from "@/components/landing/Footer";
import { Pricing } from "@/components/landing/Pricing";
import { FAQ, faqs } from "@/components/landing/FAQ";
import { CTA } from "@/components/landing/CTA";

export const Route = createFileRoute("/tarifs")({
  component: TarifsPage,
  head: () => ({
    meta: [
      { title: "Tarifs PVIA — Plans pour les pros du BTP" },
      {
        name: "description",
        content:
          "Découvrez les tarifs PVIA : plans Starter, Pro et Entreprise pour digitaliser vos procès-verbaux de réception de travaux. Essai gratuit 14 jours sans carte.",
      },
      { property: "og:title", content: "Tarifs PVIA — Simples, transparents, sans engagement" },
      {
        property: "og:description",
        content:
          "Choisissez le plan PVIA adapté à votre entreprise. Signature électronique, PDF illimités, support inclus.",
      },
      { property: "og:url", content: "https://pvia.fr/tarifs" },
    ],
    links: [{ rel: "canonical", href: "https://pvia.fr/tarifs" }],
    scripts: [
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

function TarifsPage() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="pt-24">
        <Pricing />
        <FAQ />
        <CTA />
      </main>
      <Footer />
    </div>
  );
}

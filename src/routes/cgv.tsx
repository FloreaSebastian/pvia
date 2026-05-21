import { createFileRoute } from "@tanstack/react-router";
import { PublicPageShell } from "@/components/landing/PublicPageShell";

export const Route = createFileRoute("/cgv")({
  component: CGVPage,
  head: () => ({
    meta: [
      { title: "Conditions Générales de Vente — PVIA" },
      {
        name: "description",
        content:
          "CGV de PVIA : abonnement, paiement, résiliation, support et engagements de service.",
      },
      { property: "og:title", content: "CGV — PVIA" },
      { property: "og:url", content: "https://pvia.fr/cgv" },
    ],
    links: [{ rel: "canonical", href: "https://pvia.fr/cgv" }],
  }),
});

function CGVPage() {
  return (
    <PublicPageShell
      eyebrow="Conditions contractuelles"
      title="Conditions Générales de Vente"
      description="Les présentes CGV régissent l'utilisation du service PVIA proposé par PVIA SAS."
    >
      <h2>1. Objet</h2>
      <p>
        PVIA fournit un service en ligne (SaaS) permettant la création, la signature électronique
        et l'archivage de procès-verbaux de réception de travaux destinés aux professionnels du
        BTP.
      </p>

      <h2>2. Souscription</h2>
      <p>
        Le client souscrit à un abonnement mensuel ou annuel après création d'un compte. Un essai
        gratuit de 14 jours sans engagement est proposé.
      </p>

      <h2>3. Tarifs & paiement</h2>
      <p>
        Les tarifs en vigueur sont publiés sur la page <a href="/tarifs">/tarifs</a>. Le paiement
        s'effectue par carte bancaire via Stripe, prestataire certifié PCI-DSS.
      </p>

      <h2>4. Durée & résiliation</h2>
      <p>
        L'abonnement est reconduit tacitement à chaque période. Vous pouvez le résilier à tout
        moment depuis votre espace de facturation. La résiliation prend effet à la fin de la
        période en cours.
      </p>

      <h2>5. Disponibilité</h2>
      <p>
        PVIA s'engage à une disponibilité de 99,9% sur l'année hors maintenances planifiées.
      </p>

      <h2>6. Données & propriété</h2>
      <p>
        Le client reste propriétaire de ses données. PVIA agit en qualité de sous-traitant au sens
        du RGPD pour leur traitement.
      </p>

      <h2>7. Responsabilité</h2>
      <p>
        PVIA est tenu à une obligation de moyens. La responsabilité de PVIA est plafonnée aux
        sommes versées au titre de l'abonnement sur les 12 derniers mois.
      </p>

      <h2>8. Droit applicable</h2>
      <p>
        Les présentes CGV sont soumises au droit français. Tout litige relève de la compétence
        exclusive des tribunaux de Paris.
      </p>
    </PublicPageShell>
  );
}

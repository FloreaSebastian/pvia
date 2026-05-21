import { createFileRoute } from "@tanstack/react-router";
import { PublicPageShell } from "@/components/landing/PublicPageShell";

export const Route = createFileRoute("/confidentialite")({
  component: ConfidentialitePage,
  head: () => ({
    meta: [
      { title: "Politique de confidentialité — PVIA" },
      {
        name: "description",
        content:
          "Comment PVIA collecte, utilise et protège vos données personnelles. Politique conforme au RGPD.",
      },
      { property: "og:title", content: "Politique de confidentialité — PVIA" },
      { property: "og:url", content: "https://pvia.fr/confidentialite" },
    ],
    links: [{ rel: "canonical", href: "https://pvia.fr/confidentialite" }],
  }),
});

function ConfidentialitePage() {
  return (
    <PublicPageShell
      eyebrow="Vos données, votre contrôle"
      title="Politique de confidentialité"
      description="PVIA respecte le RGPD et applique les bonnes pratiques de protection des données personnelles."
    >
      <h2>Responsable de traitement</h2>
      <p>
        PVIA SAS, 1 rue de la Réception, 75001 Paris. Contact :{" "}
        <a href="mailto:privacy@pvia.fr">privacy@pvia.fr</a>.
      </p>

      <h2>Données collectées</h2>
      <ul>
        <li>Données de compte : nom, email, entreprise, mot de passe (haché)</li>
        <li>Données métier : chantiers, clients, PV, photos, signatures</li>
        <li>Données techniques : adresse IP, type d'appareil, logs de connexion</li>
      </ul>

      <h2>Finalités</h2>
      <ul>
        <li>Fourniture du service PVIA</li>
        <li>Archivage légal des procès-verbaux signés (10 ans)</li>
        <li>Facturation et support client</li>
        <li>Sécurité, prévention de la fraude et audit</li>
      </ul>

      <h2>Base légale</h2>
      <p>
        Exécution du contrat, obligations légales (archivage), intérêt légitime (sécurité) et
        consentement (cookies analytiques).
      </p>

      <h2>Durées de conservation</h2>
      <ul>
        <li>Compte actif : durée d'utilisation du service</li>
        <li>PV signés : 10 ans (garantie décennale)</li>
        <li>Logs de sécurité : 12 mois</li>
        <li>Données de facturation : 10 ans</li>
      </ul>

      <h2>Sous-traitants</h2>
      <p>
        Hébergement européen, signature électronique (eIDAS), paiement (Stripe), envoi
        transactionnel (Resend). Tous sont liés par des accords conformes au RGPD.
      </p>

      <h2>Vos droits</h2>
      <p>
        Accès, rectification, effacement, portabilité, opposition, limitation. Pour exercer ces
        droits : <a href="mailto:privacy@pvia.fr">privacy@pvia.fr</a>. Vous pouvez également saisir
        la <a href="https://www.cnil.fr">CNIL</a>.
      </p>
    </PublicPageShell>
  );
}

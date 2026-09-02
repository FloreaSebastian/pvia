import { createFileRoute } from "@tanstack/react-router";
import { PublicPageShell } from "@/components/landing/PublicPageShell";

export const Route = createFileRoute("/securite")({
  component: SecuritePage,
  head: () => ({
    meta: [
      { title: "Sécurité & RGPD — PVIA" },
      {
        name: "description",
        content:
          "Chiffrement en transit et au repos, hébergement européen, signature électronique eIDAS simple à valeur probante renforcée et conformité RGPD.",
      },
      { property: "og:title", content: "Sécurité & RGPD — PVIA" },
      {
        property: "og:description",
        content:
          "Comment PVIA protège vos données : chiffrement, hébergement UE, journal d'audit et preuve de signature électronique.",
      },
      { property: "og:url", content: "https://pvia.fr/securite" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "https://pvia.fr/securite" }],
  }),
});

function SecuritePage() {
  return (
    <PublicPageShell
      eyebrow="Sécurité & conformité"
      title="Vos données protégées, sans promesse invérifiable"
      description="PVIA chiffre vos données en transit et au repos, les héberge dans l'Union européenne et attache à chaque signature un dossier de preuve horodaté."
    >
      <h2>Signature électronique</h2>
      <p>
        Les PV signés via PVIA utilisent une <strong>signature électronique simple (SES)</strong> au
        sens de l'article 3.10 du règlement eIDAS (UE) 910/2014. Il ne s'agit ni d'une signature
        avancée ni d'une signature qualifiée : PVIA n'émet pas de certificat qualifié et ne fait pas
        appel à un prestataire de services de confiance qualifié.
      </p>
      <p>
        La valeur probante repose sur le dossier de preuve joint à chaque PDF : vérification de
        l'email du signataire par code à usage unique, date et heure du serveur, adresse IP,
        navigateur, consentement explicite et empreinte SHA-256 du document signé. Ce faisceau
        d'indices est recevable en justice, son appréciation relevant du juge.
      </p>

      <h2>Hébergement et localisation des données</h2>
      <p>
        La base de données, les fichiers (photos, PDF) et l'application sont hébergés sur une
        infrastructure managée Supabase déployée en région <strong>AWS eu-west-1 (Irlande)</strong>,
        au sein de l'Union européenne, et distribués via le réseau Cloudflare.
      </p>
      <p>
        Certains sous-traitants nécessaires au service peuvent traiter des données en dehors de
        l'Union européenne : <strong>Stripe</strong> (paiement et facturation) et{" "}
        <strong>Resend</strong> (envoi des emails transactionnels). Nous ne pouvons donc pas
        affirmer qu'aucune donnée ne quitte l'Union européenne. La liste à jour des sous-traitants
        et de leurs garanties de transfert est disponible sur demande.
      </p>

      <h2>Chiffrement</h2>
      <ul>
        <li>
          Transit : HTTPS/TLS sur toutes les connexions, avec en-tête HSTS
          (<code>max-age=31536000; includeSubDomains</code>).
        </li>
        <li>
          Au repos : chiffrement des volumes de base de données et du stockage de fichiers assuré
          par l'hébergeur, selon ses propres garanties.
        </li>
        <li>
          Fichiers sensibles : accès uniquement via des URL signées à durée de vie courte, jamais en
          lecture publique.
        </li>
        <li>
          Authentification : connexion sans mot de passe par code à usage unique (OTP) envoyé par
          email ; les codes sont stockés hachés en SHA-256, à usage unique, expirants et limités en
          nombre de tentatives.
        </li>
      </ul>
      <p className="text-sm text-muted-foreground">
        PVIA ne pratique pas de chiffrement de bout en bout : le service doit pouvoir lire vos
        données pour générer les PDF et les envoyer à vos clients.
      </p>

      <h2>Cloisonnement des données</h2>
      <p>
        Chaque entreprise est isolée au niveau de la base de données par des règles de sécurité au
        niveau des lignes (RLS). Les espaces professionnel et client sont séparés : un client final
        n'accède qu'aux documents qui le concernent.
      </p>

      <h2>Conformité RGPD</h2>
      <p>
        PVIA traite uniquement les données nécessaires à la création, à la signature et à
        l'archivage de vos procès-verbaux. Vous pouvez exporter ou demander la suppression de vos
        données à tout moment depuis votre espace ou par email.
      </p>

      <h2>Conservation</h2>
      <p>
        Les PV signés et leurs preuves sont conservés pendant toute la durée de votre abonnement et
        restent exportables. Aucune conservation à valeur d'archivage électronique probatoire
        (NF Z42-013) n'est aujourd'hui garantie : pour une conservation décennale opposable,
        conservez également l'export PDF de votre côté.
      </p>

      <h2>Sauvegardes et disponibilité</h2>
      <p>
        Les sauvegardes automatiques de la base de données sont assurées par l'hébergeur selon son
        plan de service. PVIA ne s'engage pas contractuellement sur un SLA de disponibilité chiffré
        ; l'état du service et les incidents sont communiqués par email aux administrateurs.
      </p>

      <h2>Audit & monitoring</h2>
      <p>
        Les actions sensibles (création, signature, envoi, levée de réserve, changement de rôle,
        facturation) sont tracées dans un journal d'audit consultable depuis votre espace
        administrateur. Les erreurs applicatives sont collectées et supervisées.
      </p>

      <h2>Certifications</h2>
      <p>
        PVIA n'est pas certifiée ISO 27001 ni HDS. Nos hébergeurs disposent de leurs propres
        certifications, qui ne s'étendent pas automatiquement à PVIA.
      </p>

      <p className="text-sm text-muted-foreground">
        Question de sécurité ou signalement de vulnérabilité :{" "}
        <a href="mailto:security@pvia.fr">security@pvia.fr</a>.
      </p>
    </PublicPageShell>
  );
}

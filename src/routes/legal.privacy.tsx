import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicPageShell } from "@/components/landing/PublicPageShell";

export const Route = createFileRoute("/legal/privacy")({
  component: LegalPrivacyPage,
  head: () => ({
    meta: [
      { title: "Données personnelles & signature électronique — PVIA" },
      {
        name: "description",
        content:
          "Comment PVIA collecte et conserve les données liées à la signature électronique de vos PV de réception : IP, user-agent, identité, durée de conservation, droits RGPD.",
      },
      { property: "og:title", content: "Données & signature électronique — PVIA" },
      {
        property: "og:description",
        content:
          "Politique RGPD spécifique aux signatures électroniques PVIA : preuve de réception, IP, user-agent, droits.",
      },
      { property: "og:url", content: "https://pvia.fr/legal/privacy" },
    ],
    links: [{ rel: "canonical", href: "https://pvia.fr/legal/privacy" }],
  }),
});

function LegalPrivacyPage() {
  return (
    <PublicPageShell
      eyebrow="Conformité RGPD"
      title="Données personnelles & signature électronique"
      description="Cette page complète notre politique de confidentialité et détaille spécifiquement les données collectées lors d'une signature électronique sur PVIA."
    >
      <h2>1. Nature de la signature</h2>
      <p>
        PVIA propose une <strong>signature électronique simple</strong> au sens de
        l'article 3.10 du règlement européen eIDAS n°910/2014. Elle n'a pas la
        valeur d'une signature qualifiée et ne nécessite pas de tiers
        certificateur. Elle constitue néanmoins un commencement de preuve écrit
        opposable, conformément à l'article 1367 du Code civil français.
      </p>

      <h2>2. Données collectées au moment de la signature</h2>
      <ul>
        <li><strong>Identité du signataire</strong> : nom, prénom, qualité, adresse email.</li>
        <li><strong>Signature manuscrite</strong> capturée sur écran (image PNG).</li>
        <li><strong>Adresse IP publique</strong> du signataire.</li>
        <li><strong>User-agent</strong> du navigateur (appareil, version, OS).</li>
        <li><strong>Horodatage</strong> du serveur (UTC) au moment du dépôt de signature.</li>
        <li><strong>Texte du consentement</strong> affiché et version (ex. <code>SIGN_CONSENT_TEXT_V1</code>).</li>
        <li><strong>Token de signature</strong> haché en SHA-256 (le token en clair n'est jamais stocké côté serveur).</li>
      </ul>

      <h2>3. Finalité</h2>
      <p>
        Ces données constituent le <strong>faisceau de preuve</strong> attestant
        que le signataire identifié a bien validé le procès-verbal de réception
        de travaux concerné, à un instant donné, depuis un appareil donné. Elles
        servent exclusivement à prouver la réalité et l'intégrité du
        consentement en cas de litige.
      </p>

      <h2>4. Base légale</h2>
      <p>
        Exécution d'un contrat (art. 6.1.b RGPD) entre le client et l'entreprise
        de bâtiment utilisatrice de PVIA, et intérêt légitime à conserver une
        preuve opposable (art. 6.1.f RGPD).
      </p>

      <h2>5. Durée de conservation</h2>
      <p>
        Les éléments de preuve liés à la signature sont conservés pendant{" "}
        <strong>10 ans</strong> à compter de la signature, durée alignée sur la
        prescription décennale de la responsabilité des constructeurs
        (art. 1792 et 2224 du Code civil). Au-delà, ils sont supprimés ou
        anonymisés.
      </p>

      <h2>6. Destinataires</h2>
      <ul>
        <li>L'entreprise de bâtiment émettrice du PV (responsable de traitement).</li>
        <li>Le client signataire (copie du PV signé envoyée par email).</li>
        <li>PVIA, en qualité de <strong>sous-traitant</strong> au sens de l'art. 28 RGPD.</li>
        <li>Hébergement : Supabase (UE — Francfort) / Cloudflare (UE).</li>
      </ul>

      <h2>7. Sécurité</h2>
      <ul>
        <li>Chiffrement TLS 1.3 sur toutes les communications.</li>
        <li>Token de signature haché côté serveur (SHA-256) — jamais stocké en clair.</li>
        <li>Verrouillage des PV signés (aucune modification possible après signature).</li>
        <li>Journal d'audit horodaté (table <code>audit_logs</code>).</li>
        <li>Accès aux signatures restreint aux membres actifs de l'entreprise émettrice (RLS Postgres).</li>
      </ul>

      <h2>8. Vos droits</h2>
      <p>
        Vous disposez d'un droit d'accès, de rectification, d'effacement, de
        limitation, d'opposition et de portabilité. Vous pouvez également
        introduire une réclamation auprès de la CNIL.
      </p>
      <ul>
        <li>Email : <a href="mailto:contact@pvia.fr">contact@pvia.fr</a></li>
        <li>Délai de réponse : 30 jours maximum.</li>
      </ul>
      <p>
        Voir aussi notre{" "}
        <Link to="/confidentialite" className="text-primary underline">
          politique de confidentialité générale
        </Link>
        .
      </p>

      <h2>9. Limitations</h2>
      <p>
        PVIA ne prétend <strong>pas</strong> proposer de signature électronique
        qualifiée au sens d'eIDAS. Pour les actes nécessitant une signature
        qualifiée (acte authentique notarié, certaines pièces de marché public),
        un prestataire de service de confiance qualifié (PSCo qualifié) doit
        être utilisé.
      </p>

      <p className="text-sm text-muted-foreground">
        Dernière mise à jour : 15 juin 2026.
      </p>
    </PublicPageShell>
  );
}

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
          "Chiffrement, hébergement européen, signature électronique eIDAS et conformité RGPD : découvrez les mesures de sécurité de PVIA.",
      },
      { property: "og:title", content: "Sécurité & RGPD — PVIA" },
      {
        property: "og:description",
        content:
          "PVIA protège vos données et celles de vos clients avec un standard de sécurité de niveau bancaire.",
      },
      { property: "og:url", content: "https://pvia.fr/securite" },
    ],
    links: [{ rel: "canonical", href: "https://pvia.fr/securite" }],
  }),
});

function SecuritePage() {
  return (
    <PublicPageShell
      eyebrow="Sécurité & conformité"
      title="Vos données protégées au niveau bancaire"
      description="PVIA combine chiffrement de bout en bout, hébergement européen et signature électronique conforme eIDAS pour offrir une réception de travaux 100% sécurisée."
    >
      <h2>Signature électronique conforme eIDAS</h2>
      <p>
        Chaque PV signé via PVIA répond aux exigences du règlement européen <strong>eIDAS</strong>{" "}
        (signature électronique avancée), garantissant la valeur probante du document devant un
        tribunal français ou européen.
      </p>

      <h2>Hébergement européen</h2>
      <p>
        Toutes les données sont hébergées dans des datacenters certifiés <strong>ISO 27001</strong>{" "}
        situés en Europe. Aucune donnée n'est transférée en dehors de l'Union européenne.
      </p>

      <h2>Chiffrement</h2>
      <ul>
        <li>Transit : TLS 1.3 sur toutes les connexions</li>
        <li>Stockage : AES-256 au repos sur la base de données et le stockage de fichiers</li>
        <li>Mots de passe : hashage Argon2id, authentification sans mot de passe par OTP</li>
      </ul>

      <h2>Conformité RGPD</h2>
      <p>
        PVIA est conforme au <strong>RGPD</strong>. Nous traitons uniquement les données nécessaires
        à la création et à l'archivage légal de vos procès-verbaux. Vous gardez la maîtrise totale
        de vos données et pouvez les exporter ou les supprimer à tout moment.
      </p>

      <h2>Archivage légal 10 ans</h2>
      <p>
        Chaque PV signé est conservé pendant <strong>10 ans</strong> avec horodatage qualifié, ce
        qui correspond à la durée légale de la garantie décennale du BTP.
      </p>

      <h2>Continuité de service</h2>
      <p>
        Sauvegardes automatiques chiffrées toutes les heures, réplication géographique et SLA de
        disponibilité 99,9% sur l'année.
      </p>

      <h2>Audit & monitoring</h2>
      <p>
        Toutes les actions sensibles sont tracées dans un journal d'audit immuable, consultable
        depuis votre espace administrateur.
      </p>

      <p className="text-sm text-muted-foreground">
        Pour toute question liée à la sécurité, contactez-nous à{" "}
        <a href="mailto:security@pvia.fr">security@pvia.fr</a>.
      </p>
    </PublicPageShell>
  );
}

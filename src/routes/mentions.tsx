import { createFileRoute } from "@tanstack/react-router";
import { PublicPageShell } from "@/components/landing/PublicPageShell";
import { LEGAL_ENTITY } from "@/lib/legal-entity";

export const Route = createFileRoute("/mentions")({
  component: MentionsPage,
  head: () => ({
    meta: [
      { title: "Mentions légales — PVIA" },
      {
        name: "description",
        content:
          "Mentions légales de PVIA : éditeur, hébergeur, directeur de la publication et coordonnées.",
      },
      { property: "og:title", content: "Mentions légales de PVIA" },
      {
        property: "og:description",
        content:
          "Informations légales sur l'éditeur du site PVIA : identité, hébergement et contact.",
      },
      { property: "og:url", content: "https://pvia.fr/mentions" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "https://pvia.fr/mentions" }],
  }),
});

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <li>
      <strong>{label} : </strong>
      {value}
    </li>
  );
}

function MentionsPage() {
  const e = LEGAL_ENTITY;
  const identityPublished = Boolean(e.legalName);

  return (
    <PublicPageShell
      eyebrow="Informations légales"
      title="Mentions légales"
      description="Conformément à l'article 6-III de la loi n° 2004-575 pour la confiance dans l'économie numérique."
    >
      <h2>Éditeur du site</h2>
      {!identityPublished && (
        <p>
          Les informations d'identification de l'éditeur (dénomination sociale, forme juridique,
          capital social, siège social, RCS, SIREN/SIRET et numéro de TVA intracommunautaire) sont
          communiquées sur simple demande à l'adresse de contact indiquée ci-dessous.
        </p>
      )}
      <ul>
        <Field label="Dénomination sociale" value={e.legalName} />
        <Field label="Forme juridique" value={e.legalForm} />
        <Field label="Capital social" value={e.shareCapital} />
        <Field label="Siège social" value={e.address} />
        <Field label="RCS" value={e.rcs} />
        <Field label="SIREN / SIRET" value={e.siret} />
        <Field label="TVA intracommunautaire" value={e.vatNumber} />
      </ul>

      <h2>Directeur de la publication</h2>
      {e.publicationDirector ? (
        <p>{e.publicationDirector}</p>
      ) : (
        <p>
          Le représentant légal de l'éditeur. Son identité est communiquée sur demande à l'adresse
          de contact ci-dessous.
        </p>
      )}

      <h2>Contact</h2>
      <p>
        Email : <a href={`mailto:${e.contactEmail}`}>{e.contactEmail}</a>
      </p>

      <h2>Hébergement</h2>
      <p>
        L'application, la base de données et les fichiers sont hébergés au sein de l'Union
        européenne sur une infrastructure managée Supabase en région AWS eu-west-1 (Irlande), et
        distribués via le réseau Cloudflare. Les coordonnées complètes de chaque hébergeur peuvent
        être communiquées sur simple demande à l'adresse ci-dessus.
      </p>

      <h2>Propriété intellectuelle</h2>
      <p>
        L'ensemble des contenus (textes, logos, interfaces, code) est protégé par le droit d'auteur.
        Toute reproduction sans autorisation écrite préalable est interdite.
      </p>

      <h2>Crédits</h2>
      <p>Icônes : Lucide. Typographies : Sora, Manrope (SIL Open Font License).</p>
    </PublicPageShell>
  );
}

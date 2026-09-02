import { createFileRoute } from "@tanstack/react-router";
import { PublicPageShell } from "@/components/landing/PublicPageShell";
import { LEGAL_ENTITY, missingLegalFields } from "@/lib/legal-entity";

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
  return (
    <li>
      <strong>{label} : </strong>
      {value ?? (
        <em className="text-muted-foreground">information à fournir par l'éditeur</em>
      )}
    </li>
  );
}

function MentionsPage() {
  const e = LEGAL_ENTITY;
  const missing = missingLegalFields(e);

  return (
    <PublicPageShell
      eyebrow="Informations légales"
      title="Mentions légales"
      description="Conformément à l'article 6-III de la loi n° 2004-575 pour la confiance dans l'économie numérique."
    >
      {missing.length > 0 && (
        <div
          role="note"
          className="not-prose rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm"
        >
          <p className="font-medium">Mentions légales incomplètes</p>
          <p className="mt-1 text-muted-foreground">
            Les informations suivantes doivent être renseignées par l'éditeur à partir de son
            extrait Kbis : {missing.join(", ")}. Aucune valeur provisoire n'est publiée à leur
            place.
          </p>
        </div>
      )}

      <h2>Éditeur du site</h2>
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
      <ul>
        <Field label="Directeur de la publication" value={e.publicationDirector} />
      </ul>

      <h2>Contact</h2>
      <p>
        Email : <a href={`mailto:${e.contactEmail}`}>{e.contactEmail}</a>
      </p>

      <h2>Hébergement</h2>
      <p>
        L'application et la base de données sont hébergées au sein de l'Union européenne
        (infrastructure managée Supabase sur AWS, région Europe) et distribuées via le réseau
        Cloudflare. Les coordonnées complètes de chaque hébergeur peuvent être communiquées sur
        simple demande à l'adresse ci-dessus.
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

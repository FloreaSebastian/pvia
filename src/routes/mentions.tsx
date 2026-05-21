import { createFileRoute } from "@tanstack/react-router";
import { PublicPageShell } from "@/components/landing/PublicPageShell";

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
      { property: "og:title", content: "Mentions légales de PVIA SAS" },
      {
        property: "og:description",
        content:
          "Informations légales obligatoires sur l'éditeur du site PVIA : raison sociale, RCS, hébergement et contact.",
      },
      { property: "og:url", content: "https://pvia.fr/mentions" },
    ],
    links: [{ rel: "canonical", href: "https://pvia.fr/mentions" }],
  }),
});

function MentionsPage() {
  return (
    <PublicPageShell
      eyebrow="Informations légales"
      title="Mentions légales"
      description="Conformément aux dispositions de la loi pour la confiance dans l'économie numérique."
    >
      <h2>Éditeur du site</h2>
      <p>
        <strong>PVIA SAS</strong>
        <br />
        Société par actions simplifiée
        <br />
        Capital social : 10 000 €
        <br />
        Siège social : 1 rue de la Réception, 75001 Paris, France
        <br />
        RCS Paris : 000 000 000
        <br />
        N° TVA intracommunautaire : FR00 000000000
      </p>

      <h2>Directeur de la publication</h2>
      <p>Le représentant légal de PVIA SAS.</p>

      <h2>Contact</h2>
      <p>
        Email : <a href="mailto:contact@pvia.fr">contact@pvia.fr</a>
      </p>

      <h2>Hébergement</h2>
      <p>
        Les données sont hébergées au sein de l'Union européenne par des prestataires certifiés
        ISO 27001. Le site est servi via une infrastructure edge globale.
      </p>

      <h2>Propriété intellectuelle</h2>
      <p>
        L'ensemble des contenus (textes, logos, interfaces, code) est la propriété exclusive de
        PVIA SAS, sauf mention contraire. Toute reproduction sans autorisation écrite préalable est
        interdite.
      </p>

      <h2>Crédits</h2>
      <p>
        Conception & développement : PVIA SAS. Icônes : Lucide. Typographies : Sora, Manrope (SIL
        Open Font License).
      </p>
    </PublicPageShell>
  );
}

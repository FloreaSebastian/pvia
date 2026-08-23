import { createFileRoute } from "@tanstack/react-router";
import { SolutionsHub } from "@/components/landing/solutions/SolutionsHub";

const TITLE = "Solutions PVIA — réception, réserves, terrain et suivi de chantier";
const DESCRIPTION =
  "Découvrez comment PVIA couvre chaque étape de vos travaux : PV de réception, réserves et levées, mode terrain, signature et PDF, espace client, chantiers, planning, équipes et pilotage.";

export const Route = createFileRoute("/solutions/")({
  component: SolutionsHub,
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://pvia.fr/solutions" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESCRIPTION },
    ],
    links: [{ rel: "canonical", href: "https://pvia.fr/solutions" }],
  }),
});

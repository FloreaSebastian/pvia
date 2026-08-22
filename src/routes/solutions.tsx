import { createFileRoute, Outlet } from "@tanstack/react-router";

const TITLE = "Solutions métiers — logiciel de réception de travaux | PVIA";
const DESCRIPTION =
  "PVIA s'adapte à votre métier : photovoltaïque, climatisation et PAC, électricité, plomberie, rénovation et construction. Même méthode de réception, vos réalités de terrain.";

export const Route = createFileRoute("/solutions")({
  component: SolutionsLayout,
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
  }),
});

function SolutionsLayout() {
  return <Outlet />;
}

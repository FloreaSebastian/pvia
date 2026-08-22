import { createFileRoute } from "@tanstack/react-router";
import { SolutionsOverview } from "@/components/landing/SolutionsOverview";

export const Route = createFileRoute("/solutions/")({
  component: SolutionsOverview,
  head: () => ({
    links: [{ rel: "canonical", href: "https://pvia.fr/solutions" }],
  }),
});

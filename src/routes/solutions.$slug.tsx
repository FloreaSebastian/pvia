import { createFileRoute, notFound } from "@tanstack/react-router";
import { IndustryPage } from "@/components/landing/IndustryPage";
import { getSolution } from "@/components/landing/solutions-data";

export const Route = createFileRoute("/solutions/$slug")({
  loader: ({ params }) => {
    const solution = getSolution(params.slug);
    if (!solution) throw notFound();
    return { solution };
  },
  head: ({ params, loaderData }) => {
    if (!loaderData) {
      return {
        meta: [{ title: "Page introuvable — PVIA" }, { name: "robots", content: "noindex" }],
      };
    }
    const { solution } = loaderData;
    const url = `https://pvia.fr/solutions/${params.slug}`;
    return {
      meta: [
        { title: solution.seoTitle },
        { name: "description", content: solution.seoDescription },
        { property: "og:title", content: solution.seoTitle },
        { property: "og:description", content: solution.seoDescription },
        { property: "og:type", content: "website" },
        { property: "og:url", content: url },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: solution.seoTitle },
        { name: "twitter:description", content: solution.seoDescription },
      ],
      links: [{ rel: "canonical", href: url }],
    };
  },
  component: SolutionPage,
});

function SolutionPage() {
  const { solution } = Route.useLoaderData();
  return <IndustryPage solution={solution} />;
}

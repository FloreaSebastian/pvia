import { createFileRoute, notFound } from "@tanstack/react-router";
import { IndustryPage } from "@/components/landing/IndustryPage";
import { getSolution } from "@/components/landing/solutions-data";
import { getSolutionPage } from "@/components/landing/solutions/content";
import { SolutionPage } from "@/components/landing/solutions/SolutionPage";

export const Route = createFileRoute("/solutions/$slug")({
  loader: ({ params }) => {
    if (getSolutionPage(params.slug)) return { kind: "solution" as const };
    const solution = getSolution(params.slug);
    if (!solution) throw notFound();
    return { kind: "industry" as const };
  },
  head: ({ params, loaderData }) => {
    if (!loaderData) {
      return {
        meta: [{ title: "Page introuvable — PVIA" }, { name: "robots", content: "noindex" }],
      };
    }
    const page = getSolutionPage(params.slug);
    const industry = getSolution(params.slug);
    const seoTitle = page?.seoTitle ?? industry?.seoTitle ?? "Solutions — PVIA";
    const seoDescription = page?.seoDescription ?? industry?.seoDescription ?? "";
    const url = `https://pvia.fr/solutions/${params.slug}`;
    return {
      meta: [
        { title: seoTitle },
        { name: "description", content: seoDescription },
        { property: "og:title", content: seoTitle },
        { property: "og:description", content: seoDescription },
        { property: "og:type", content: "website" },
        { property: "og:url", content: url },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: seoTitle },
        { name: "twitter:description", content: seoDescription },
      ],
      links: [{ rel: "canonical", href: url }],
    };
  },
  component: SolutionRoute,
});

function SolutionRoute() {
  const { slug } = Route.useParams();
  const page = getSolutionPage(slug);
  if (page) return <SolutionPage page={page} />;
  const industry = getSolution(slug);
  return industry ? <IndustryPage solution={industry} /> : null;
}

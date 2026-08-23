import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

const BASE_URL = "https://pvia.fr";

interface SitemapEntry {
  path: string;
  changefreq?: "daily" | "weekly" | "monthly" | "yearly";
  priority?: string;
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        // Only public, indexable pages. Auth-gated app routes stay out.
        const entries: SitemapEntry[] = [
          { path: "/", changefreq: "weekly", priority: "1.0" },
          { path: "/fonctionnalites", changefreq: "weekly", priority: "0.9" },
          { path: "/comment-ca-marche", changefreq: "weekly", priority: "0.9" },
          { path: "/pourquoi-pvia", changefreq: "monthly", priority: "0.8" },
          { path: "/solutions", changefreq: "weekly", priority: "0.9" },
          { path: "/solutions/pv-reception", changefreq: "weekly", priority: "0.9" },
          { path: "/solutions/reserves", changefreq: "weekly", priority: "0.9" },
          { path: "/solutions/terrain", changefreq: "weekly", priority: "0.9" },
          { path: "/solutions/signature-pdf", changefreq: "weekly", priority: "0.9" },
          { path: "/solutions/espace-client", changefreq: "weekly", priority: "0.9" },
          { path: "/solutions/chantiers", changefreq: "weekly", priority: "0.9" },
          { path: "/solutions/planning", changefreq: "weekly", priority: "0.9" },
          { path: "/solutions/equipes", changefreq: "weekly", priority: "0.9" },
          { path: "/solutions/suivi-pilotage", changefreq: "weekly", priority: "0.9" },
          { path: "/solutions/photovoltaique", changefreq: "monthly", priority: "0.7" },
          { path: "/solutions/climatisation", changefreq: "monthly", priority: "0.7" },
          { path: "/solutions/electricite", changefreq: "monthly", priority: "0.7" },
          { path: "/solutions/plomberie", changefreq: "monthly", priority: "0.7" },
          { path: "/solutions/renovation", changefreq: "monthly", priority: "0.7" },
          { path: "/solutions/construction", changefreq: "monthly", priority: "0.7" },
          { path: "/contact", changefreq: "monthly", priority: "0.6" },
          { path: "/tarifs", changefreq: "weekly", priority: "0.9" },
          { path: "/securite", changefreq: "monthly", priority: "0.7" },

          { path: "/signup", changefreq: "monthly", priority: "0.6" },
          { path: "/login", changefreq: "monthly", priority: "0.3" },
          { path: "/cgv", changefreq: "yearly", priority: "0.2" },
          { path: "/mentions", changefreq: "yearly", priority: "0.2" },
          { path: "/confidentialite", changefreq: "yearly", priority: "0.2" },
        ];

        const urls = entries
          .map((e) =>
            [
              "  <url>",
              `    <loc>${BASE_URL}${e.path}</loc>`,
              e.changefreq ? `    <changefreq>${e.changefreq}</changefreq>` : null,
              e.priority ? `    <priority>${e.priority}</priority>` : null,
              "  </url>",
            ]
              .filter(Boolean)
              .join("\n"),
          )
          .join("\n");

        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;

        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});

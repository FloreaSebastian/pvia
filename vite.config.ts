// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
// @cloudflare/vite-plugin builds from this — wrangler.jsonc main alone is insufficient.
// Identifiant de build : permet de vérifier que la version testée en production
// est bien la dernière publiée (affiché dans le diagnostic cartographie).
const BUILD_ID =
  process.env["BUILD_ID"] ??
  process.env["CF_PAGES_COMMIT_SHA"]?.slice(0, 7) ??
  new Date().toISOString().replace(/[-:]/g, "").slice(0, 13);

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    define: {
      "import.meta.env.VITE_BUILD_ID": JSON.stringify(BUILD_ID),
      "process.env.BUILD_ID": JSON.stringify(BUILD_ID),
    },
  },
});

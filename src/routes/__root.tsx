import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";

import { useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";

import appCss from "../styles.css?url";
import { isChunkLoadError, recoverFromChunkError } from "@/lib/chunk-recovery";
import { AppToaster } from "@/components/app/AppToaster";
import { PwaRegister } from "@/components/app/PwaRegister";
import { AnalyticsTracker } from "@/components/app/AnalyticsTracker";
import { UserPreferencesProvider } from "@/components/app/UserPreferencesProvider";
import { reportClientCrash } from "@/lib/client-crash.functions";

const NO_FLASH_SCRIPT = `(function(){try{var p=JSON.parse(localStorage.getItem('pvia.user_prefs.v1')||'{}');var r=document.documentElement;if(p.dark_mode_enabled)r.classList.add('dark');if(p.ui_density)r.dataset.density=p.ui_density;if(p.animations_enabled===false){r.dataset.animations='off';r.style.setProperty('--pvia-motion','0');}}catch(e){}})();`;

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  const reportCrash = useServerFn(reportClientCrash);
  const chunkError = isChunkLoadError(error);

  useEffect(() => {
    // Bundle désynchronisé après déploiement : une seule tentative de
    // rechargement propre (purge caches PWA), jamais pour une erreur métier.
    if (chunkError) recoverFromChunkError(error);
  }, [chunkError, error]);

  useEffect(() => {
    if (chunkError || typeof window === "undefined") return;
    reportCrash({
      data: {
        route: window.location.pathname,
        message: error.message || error.name || "Client runtime error",
        stack: error.stack,
      },
    }).catch((reportError) => {
      console.warn("Impossible de transmettre le diagnostic client", reportError);
    });
  }, [chunkError, error, reportCrash]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Cette page n’a pas pu être chargée
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {chunkError
            ? "Une nouvelle version de l'application est disponible. Rechargez la page pour continuer."
            : "Une erreur inattendue est survenue. Réessayez dans quelques instants ou revenez à l’accueil."}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Réessayer
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Accueil
          </a>
          <a
            href="/login"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Se connecter
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "PVIA — Réception de travaux intelligente" },
      { name: "description", content: "Créez, signez et envoyez vos procès-verbaux de réception depuis le terrain." },
      { name: "google-site-verification", content: "TQJFnvDZHA9ShvV3f_ynMorYFbbspVT-Hpche8ucD5Y" },
      { name: "theme-color", content: "#1e40af" },
      { name: "application-name", content: "PVIA" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "PVIA" },
      { name: "mobile-web-app-capable", content: "yes" },
      { property: "og:site_name", content: "PVIA" },
      { property: "og:locale", content: "fr_FR" },
      { property: "og:title", content: "PVIA — Réception de travaux intelligente" },
      { property: "og:description", content: "Créez, signez et envoyez vos procès-verbaux de réception depuis le terrain." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "PVIA — Réception de travaux intelligente" },
      { name: "twitter:description", content: "Créez, signez et envoyez vos procès-verbaux de réception depuis le terrain." },
      { property: "og:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/5293ff41-8f08-459e-8639-fe6988e7e600" },
      { name: "twitter:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/5293ff41-8f08-459e-8639-fe6988e7e600" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700;800&family=Manrope:wght@400;500;600;700;800&family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,600;12..96,700;12..96,800&display=swap",
      },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/icons/apple-touch-icon.png" },
      { rel: "icon", type: "image/png", sizes: "192x192", href: "/icons/icon-192.png" },
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32.png" },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Organization",
          name: "PVIA",
          url: "https://pvia.fr",
          logo: "https://pvia.fr/icons/icon-512.png",
          description:
            "Solution SaaS de procès-verbaux de réception de travaux pour les professionnels du BTP.",
          address: {
            "@type": "PostalAddress",
            streetAddress: "1 rue de la Réception",
            postalCode: "75001",
            addressLocality: "Paris",
            addressCountry: "FR",
          },
          contactPoint: {
            "@type": "ContactPoint",
            email: "contact@pvia.fr",
            contactType: "customer support",
            areaServed: "FR",
            availableLanguage: ["French"],
          },
        }),
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    // Le script anti-flash écrit class/data-* sur <html> avant l'hydratation.
    <html lang="fr" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_SCRIPT }} />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <UserPreferencesProvider>
        <Outlet />
        <AppToaster />
        <PwaRegister />
        <AnalyticsTracker />
      </UserPreferencesProvider>
    </QueryClientProvider>
  );
}

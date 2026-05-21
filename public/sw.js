/* PVIA service worker — handwritten, no workbox.
 * Strategy:
 *  - HTML navigations: NetworkFirst with offline fallback to /offline.html
 *  - Same-origin static assets (js/css/images/fonts): StaleWhileRevalidate
 *  - Cross-origin: passthrough (no caching)
 *  - Push: shows native notification, opens app on click
 *
 * The SW is registered only on production hosts (not in Lovable preview iframe)
 * via src/components/app/PwaRegister.tsx.
 */

const VERSION = "pvia-v1";
const STATIC_CACHE = `pvia-static-${VERSION}`;
const RUNTIME_CACHE = `pvia-runtime-${VERSION}`;
const HTML_CACHE = `pvia-html-${VERSION}`;
const OFFLINE_URL = "/offline.html";

const PRECACHE_URLS = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      await cache.addAll(PRECACHE_URLS).catch(() => {});
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.startsWith("pvia-") && !n.endsWith(VERSION))
          .map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

function isHtmlRequest(request) {
  return (
    request.mode === "navigate" ||
    (request.method === "GET" &&
      request.headers.get("accept")?.includes("text/html"))
  );
}

function isSameOriginStatic(url) {
  if (url.origin !== self.location.origin) return false;
  // Never cache server functions / API / auth callbacks
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/_serverFn") ||
    url.pathname.startsWith("/_server") ||
    url.pathname.startsWith("/~oauth") ||
    url.pathname.startsWith("/auth/")
  ) {
    return false;
  }
  return /\.(?:js|mjs|css|png|jpg|jpeg|svg|webp|gif|ico|woff2?|ttf|otf)$/i.test(
    url.pathname
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // HTML navigations: NetworkFirst with offline fallback
  if (isHtmlRequest(request)) {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(HTML_CACHE);
          cache.put(request, fresh.clone()).catch(() => {});
          return fresh;
        } catch {
          const cached = await caches.match(request);
          if (cached) return cached;
          const offline = await caches.match(OFFLINE_URL);
          return (
            offline ||
            new Response("Hors ligne", {
              status: 503,
              headers: { "content-type": "text/plain; charset=utf-8" },
            })
          );
        }
      })()
    );
    return;
  }

  // Static assets: StaleWhileRevalidate
  if (isSameOriginStatic(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(RUNTIME_CACHE);
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((res) => {
            if (res.ok) cache.put(request, res.clone()).catch(() => {});
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })()
    );
  }
  // else: passthrough
});

/* ---------------- Push notifications ---------------- */

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "PVIA", body: event.data?.text() || "" };
  }

  const title = payload.title || "PVIA";
  const options = {
    body: payload.body || "",
    icon: payload.icon || "/icons/icon-192.png",
    badge: payload.badge || "/icons/icon-192.png",
    tag: payload.tag,
    renotify: !!payload.renotify,
    data: { url: payload.url || "/dashboard", ...payload.data },
    vibrate: payload.vibrate || [80, 40, 80],
    requireInteraction: !!payload.requireInteraction,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification?.data?.url || "/dashboard";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const c of all) {
        if ("focus" in c) {
          try {
            await c.focus();
            if ("navigate" in c) await c.navigate(target);
            return;
          } catch {}
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(target);
    })()
  );
});

/* Allow the page to ask us to update immediately. */
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

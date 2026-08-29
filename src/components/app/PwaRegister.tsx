import { useEffect } from "react";
import { isPwaUnsafeHost } from "@/lib/pwa";
import { installChunkRecovery } from "@/lib/chunk-recovery";

/** Registers the production service worker. Safe no-op in Lovable preview / iframes. */
export function PwaRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    // Filet anti-bundle-périmé : actif même sans service worker.
    installChunkRecovery();

    if (!("serviceWorker" in navigator)) return;

    if (isPwaUnsafeHost()) {
      // Defensive cleanup: if a SW was ever registered in this preview context,
      // unregister it so it can't serve stale content.
      navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((r) => r.unregister().catch(() => {}));
      });
      return;
    }

    let registration: ServiceWorkerRegistration | undefined;

    const onLoad = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then((reg) => {
          registration = reg;
          // Un nouveau SW installé prend le contrôle immédiatement : évite
          // qu'une PWA installée (Android/tablette) reste sur l'ancien cache.
          reg.addEventListener("updatefound", () => {
            const next = reg.installing;
            next?.addEventListener("statechange", () => {
              if (next.state === "installed") next.postMessage("SKIP_WAITING");
            });
          });
        })
        .catch((err) => console.warn("[pwa] SW registration failed", err));
    };
    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad, { once: true });

    // Recherche de mise à jour au retour au premier plan (app installée).
    const onVisible = () => {
      if (document.visibilityState === "visible") registration?.update().catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);
  return null;
}

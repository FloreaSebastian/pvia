import { useEffect } from "react";
import { isPwaUnsafeHost } from "@/lib/pwa";

/** Registers the production service worker. Safe no-op in Lovable preview / iframes. */
export function PwaRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    if (isPwaUnsafeHost()) {
      // Defensive cleanup: if a SW was ever registered in this preview context,
      // unregister it so it can't serve stale content.
      navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((r) => r.unregister().catch(() => {}));
      });
      return;
    }

    const onLoad = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch((err) => console.warn("[pwa] SW registration failed", err));
    };
    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad, { once: true });
  }, []);
  return null;
}

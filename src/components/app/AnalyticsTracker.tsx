import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";
import { trackPageview } from "@/lib/analytics";

/**
 * Pageview tracker. Mount once at the root. Listens to router state changes
 * and emits a `pageview` event on every successful navigation.
 */
export function AnalyticsTracker() {
  const router = useRouter();
  useEffect(() => {
    // initial
    trackPageview(window.location.pathname);
    const unsub = router.subscribe("onResolved", (e) => {
      try {
        const path = e.toLocation?.pathname ?? window.location.pathname;
        trackPageview(path);
      } catch {}
    });
    return () => {
      try { unsub(); } catch {}
    };
  }, [router]);
  return null;
}

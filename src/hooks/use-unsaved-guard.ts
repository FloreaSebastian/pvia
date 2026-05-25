import { useEffect } from "react";

/**
 * Warn before leaving the tab if there are unsaved changes (native dialog).
 * Doesn't intercept in-app navigation — pair with a confirm() in the click
 * handler if you need to block client-side route changes.
 */
export function useUnsavedGuard(dirty: boolean, message = "Modifications non enregistrées. Quitter quand même ?") {
  useEffect(() => {
    if (!dirty || typeof window === "undefined") return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = message;
      return message;
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, message]);
}

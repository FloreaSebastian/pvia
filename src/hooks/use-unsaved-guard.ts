import { useEffect } from "react";
import { useBlocker } from "@tanstack/react-router";

/**
 * Protège contre la perte de saisies non enregistrées :
 * - fermeture / rechargement de l'onglet (dialogue natif `beforeunload`) ;
 * - navigation interne TanStack Router (confirmation explicite).
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

  useBlocker({
    shouldBlockFn: () => (typeof window === "undefined" ? false : !window.confirm(message)),
    enableBeforeUnload: false,
    disabled: !dirty,
  });
}

import * as React from "react";

/**
 * Postures d'affichage PVIA.
 * On ne raisonne pas en "mobile / tablette / desktop" mais en espace réellement
 * disponible, afin de couvrir les largeurs atypiques des smartphones pliables.
 *
 * - compact  : Fold fermé, très petits écrans (< 400px)
 * - mobile   : smartphone classique (400 – 599px)
 * - fold     : Fold ouvert / petite tablette portrait (600 – 899px)
 * - tablet   : tablette (900 – 1279px)
 * - desktop  : ordinateur (≥ 1280px)
 */
export type Posture = "compact" | "mobile" | "fold" | "tablet" | "desktop";

export function posturize(width: number): Posture {
  if (width < 400) return "compact";
  if (width < 600) return "mobile";
  if (width < 900) return "fold";
  if (width < 1280) return "tablet";
  return "desktop";
}

type Viewport = {
  width: number;
  height: number;
  posture: Posture;
  /** Fold fermé ou petit téléphone : UI ultra simplifiée. */
  isCompact: boolean;
  /** Toute largeur ≤ smartphone classique. */
  isMobile: boolean;
  /** Fold ouvert / tablette portrait : on peut passer en 2 colonnes. */
  isFoldOpen: boolean;
  /** Espace suffisant pour une navigation latérale. */
  isDesktop: boolean;
  isLandscape: boolean;
};

function read(): Viewport {
  const width = typeof window === "undefined" ? 1280 : (window.visualViewport?.width ?? window.innerWidth);
  const height = typeof window === "undefined" ? 800 : (window.visualViewport?.height ?? window.innerHeight);
  const posture = posturize(width);
  return {
    width,
    height,
    posture,
    isCompact: posture === "compact",
    isMobile: posture === "compact" || posture === "mobile",
    isFoldOpen: posture === "fold",
    isDesktop: posture === "desktop" || posture === "tablet",
    isLandscape: width >= height,
  };
}

const SSR_VIEWPORT: Viewport = {
  width: 1280,
  height: 800,
  posture: "desktop",
  isCompact: false,
  isMobile: false,
  isFoldOpen: false,
  isDesktop: true,
  isLandscape: true,
};

/**
 * Recalcule l'interface immédiatement lors d'un changement de posture
 * (ouverture/fermeture d'un Fold, rotation, ouverture du clavier),
 * sans rechargement ni changement de route.
 */
export function useViewport(): Viewport {
  // Le premier rendu client doit être strictement identique au SSR. Lire le
  // viewport dans l'initializer produisait un arbre mobile différent du HTML
  // serveur et pouvait faire tomber l'hydratation dans la root error boundary.
  const [vp, setVp] = React.useState<Viewport>(SSR_VIEWPORT);

  React.useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setVp(read()));
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, []);

  return vp;
}

/**
 * Largeur réellement disponible pour un composant (container query en JS).
 * Utile pour les composants réutilisés dans une sidebar, une modale ou une page.
 */
export function useContainerWidth<T extends HTMLElement>() {
  const ref = React.useRef<T | null>(null);
  const [width, setWidth] = React.useState(0);

  React.useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setWidth((prev) => (Math.abs(prev - w) > 1 ? w : prev));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return { ref, width } as const;
}

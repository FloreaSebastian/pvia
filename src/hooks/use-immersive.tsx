import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/**
 * Mode immersif générique de l'application.
 *
 * Une page (calendrier plein écran, visionneuse photo, signature…) déclare
 * « une vue immersive est active » ; le layout applicatif masque alors ses
 * chromes secondaires (BottomNav mobile) sans connaître la page concernée.
 *
 * Volontairement minimaliste : un compteur de demandeurs pour supporter
 * plusieurs sources, et un nettoyage automatique au démontage (navigation).
 */
type ImmersiveCtx = {
  immersive: boolean;
  /** Enregistre/retire une demande d'immersion. Retourne rien : utiliser useImmersiveMode. */
  requestImmersive: (active: boolean) => void;
};

const Ctx = createContext<ImmersiveCtx>({ immersive: false, requestImmersive: () => {} });

export function ImmersiveProvider({ children }: { children: React.ReactNode }) {
  const [count, setCount] = useState(0);

  const requestImmersive = useCallback((active: boolean) => {
    setCount((c) => Math.max(0, c + (active ? 1 : -1)));
  }, []);

  const value = useMemo(() => ({ immersive: count > 0, requestImmersive }), [count, requestImmersive]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useImmersive() {
  return useContext(Ctx);
}

/**
 * Déclare une vue immersive tant que `active` est vrai.
 * Le nettoyage au démontage garantit qu'une navigation ne laisse jamais
 * la BottomNav masquée ni de style global résiduel.
 */
export function useImmersiveMode(active: boolean) {
  const { requestImmersive } = useImmersive();
  useEffect(() => {
    if (!active) return;
    requestImmersive(true);
    return () => requestImmersive(false);
  }, [active, requestImmersive]);
}

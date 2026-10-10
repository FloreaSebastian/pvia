/**
 * Garde de portée pour les suites d'await : une fois la portée close
 * (changement d'entreprise, démontage), aucune suite ne doit plus agir
 * (toast, rechargement, état). `isCurrent(token)` invalide aussi les
 * chargements dépassés par un chargement plus récent dans la même portée.
 */
export type ScopeGuard = {
  next: () => number;
  isCurrent: (token: number) => boolean;
  alive: () => boolean;
  dispose: () => void;
};

/** `start` : génération initiale (garde recréée après une précédente, jetons jamais réutilisés). */
export function createScopeGuard(start = 0): ScopeGuard {
  let gen = start;
  let open = true;
  return {
    next: () => ++gen,
    isCurrent: (token) => open && token === gen,
    alive: () => open,
    dispose: () => {
      open = false;
    },
  };
}

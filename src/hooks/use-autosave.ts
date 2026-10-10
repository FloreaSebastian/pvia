import { useCallback, useEffect, useRef, useState } from "react";
import { createAutosaveCore, type SaveStatus } from "@/lib/autosave-core";

export type { SaveStatus };

type Options<T> = {
  /**
   * Portée de l'éditeur (ex. `user:company`). null = données non chargées
   * avec succès : autosave et enregistrement manuel fermés.
   */
  scope: string | null;
  /** Base chargée pour cette portée (requise quand scope est non null). */
  loaded: T | undefined;
  /** Valeur courante saisie dans `scope`. */
  value: T;
  /** Enregistre `value` dans `scope` (jamais la portée active au moment de l'appel). */
  onSave: (scope: string, value: T) => Promise<void>;
  delay?: number;
  /** Autosave désactivé (droits) ; enregistrement manuel aussi refusé. */
  disabled?: boolean;
};

/**
 * Autosave différé, borné à une portée. `saveNow()` renvoie true seulement si
 * l'enregistrement a réellement réussi — jamais de succès après une erreur absorbée.
 */
export function useAutosave<T>({ scope, loaded, value, onSave, delay = 800, disabled }: Options<T>) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  const coreRef = useRef<ReturnType<typeof createAutosaveCore<T>> | null>(null);
  if (!coreRef.current) {
    coreRef.current = createAutosaveCore<T>({
      save: (s, v) => saveRef.current(s, v),
      onStatus: setStatus,
      onSaved: setLastSavedAt,
    });
  }
  const core = coreRef.current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ouverture/fermeture de portée : minuterie et réponses de l'ancienne portée abandonnées.
  const openedRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const key = scope !== null && loaded !== undefined ? scope : null;
    if (openedRef.current === key) return;
    openedRef.current = key;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    core.open(key, key === null ? undefined : loaded);
    setLastSavedAt(null);
  }, [scope, loaded, core]);

  useEffect(() => {
    if (!core.update(openedRef.current ?? null, value)) return;
    if (disabled || !core.isDirty()) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void core.flush();
    }, delay);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [value, delay, disabled, core]);

  useEffect(() => {
    if (status !== "saved") return;
    const t = setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 2000);
    return () => clearTimeout(t);
  }, [status]);

  const saveNow = useCallback(async (): Promise<boolean> => {
    if (disabled) return false;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    return core.flush();
  }, [core, disabled]);

  const resetBaseline = useCallback(
    (next: T) => {
      if (openedRef.current) core.rebase(openedRef.current, next);
    },
    [core],
  );

  return {
    status,
    lastSavedAt,
    isDirty: core.isDirty(),
    ready: openedRef.current !== null && openedRef.current !== undefined,
    saveNow,
    resetBaseline,
  };
}

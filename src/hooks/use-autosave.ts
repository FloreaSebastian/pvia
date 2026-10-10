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
  /** Valeur courante… */
  value: T;
  /** …et la portée dans laquelle elle a été saisie (valeur d'une autre portée ignorée). */
  valueScope: string | null;
  /** Enregistre `value` dans `scope` (jamais la portée active au moment de l'appel). */
  onSave: (scope: string, value: T) => Promise<void>;
  delay?: number;
  /** Autosave désactivé (droits) ; enregistrement manuel aussi refusé. */
  disabled?: boolean;
};

function makeHookCore<T>(
  saveRef: { current: (scope: string, value: T) => Promise<void> },
  mountedRef: { current: boolean },
  setStatus: (s: SaveStatus) => void,
  setLastSavedAt: (d: Date | null) => void,
) {
  return createAutosaveCore<T>({
    save: (s, v) => saveRef.current(s, v),
    onStatus: (s) => {
      if (mountedRef.current) setStatus(s);
    },
    onSaved: (at) => {
      if (mountedRef.current) setLastSavedAt(at);
    },
  });
}

/**
 * Autosave différé, borné à une portée. `saveNow()` renvoie true seulement si
 * l'enregistrement a réellement réussi — jamais de succès après une erreur absorbée.
 */
export function useAutosave<T>({
  scope,
  loaded,
  value,
  valueScope,
  onSave,
  delay = 800,
  disabled,
}: Options<T>) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  const coreRef = useRef<ReturnType<typeof createAutosaveCore<T>> | null>(null);
  const openedRef = useRef<string | null | undefined>(undefined);
  const mountedRef = useRef(true);
  if (!coreRef.current)
    coreRef.current = makeHookCore(saveRef, mountedRef, setStatus, setLastSavedAt);
  const [core, setCore] = useState(() => coreRef.current!);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cycle de vie : au démontage, minuterie annulée et cœur invalidé (commandes en
  // attente et réponses tardives sans effet). Si React remonte le composant
  // (StrictMode), un cœur neuf est créé et la portée sera rouverte.
  useEffect(() => {
    mountedRef.current = true;
    if (coreRef.current?.disposed) {
      coreRef.current = makeHookCore(saveRef, mountedRef, setStatus, setLastSavedAt);
      openedRef.current = undefined;
      setCore(coreRef.current);
    }
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      coreRef.current?.dispose();
    };
  }, []);

  // Ouverture/fermeture de portée : minuterie et réponses de l'ancienne portée abandonnées.
  useEffect(() => {
    if (core.disposed) return;
    const key = scope !== null && loaded !== undefined ? scope : null;
    if (openedRef.current === key) return;
    openedRef.current = key;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    core.open(key, key === null ? undefined : loaded);
    setLastSavedAt(null);
  }, [scope, loaded, core]);

  useEffect(() => {
    if (valueScope !== openedRef.current || !core.update(valueScope, value)) return;
    if (disabled || !core.isDirty()) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void core.flush();
    }, delay);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [value, valueScope, delay, disabled, core]);

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

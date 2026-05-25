import { useCallback, useEffect, useRef, useState } from "react";

export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

type Options<T> = {
  /** Current value of the form */
  value: T;
  /** Async save handler. Throw to mark as error. */
  onSave: (value: T) => Promise<void>;
  /** Debounce delay in ms before auto-save fires after last change. Default 800. */
  delay?: number;
  /** Disable autosave (still allows manual save via saveNow). */
  disabled?: boolean;
  /** Compare equality to detect "dirty". Defaults to JSON deep-equality. */
  isEqual?: (a: T, b: T) => boolean;
};

/**
 * Debounced autosave hook with status indicator + dirty detection.
 *
 * - "dirty" appears as soon as `value` differs from the last committed baseline.
 * - After `delay` ms of inactivity, saves automatically.
 * - `saveNow()` triggers an immediate save (e.g. Cmd+S).
 * - `reset()` snaps the baseline to the current value without saving.
 */
export function useAutosave<T>({
  value,
  onSave,
  delay = 800,
  disabled,
  isEqual,
}: Options<T>) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const baselineRef = useRef<T>(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const latestRef = useRef<T>(value);

  const eq = useCallback(
    (a: T, b: T) => (isEqual ? isEqual(a, b) : JSON.stringify(a) === JSON.stringify(b)),
    [isEqual],
  );

  const commit = useCallback(async () => {
    if (inFlightRef.current) await inFlightRef.current;
    const snapshot = latestRef.current;
    if (eq(snapshot, baselineRef.current)) {
      setStatus("idle");
      return;
    }
    setStatus("saving");
    const p = (async () => {
      try {
        await onSave(snapshot);
        baselineRef.current = snapshot;
        setLastSavedAt(new Date());
        // If the value moved again while saving, stay dirty
        if (!eq(latestRef.current, baselineRef.current)) setStatus("dirty");
        else setStatus("saved");
      } catch {
        setStatus("error");
      } finally {
        inFlightRef.current = null;
      }
    })();
    inFlightRef.current = p;
    await p;
  }, [eq, onSave]);

  // Track latest value
  useEffect(() => { latestRef.current = value; }, [value]);

  // Trigger autosave on dirty
  useEffect(() => {
    if (disabled) return;
    const dirty = !eq(value, baselineRef.current);
    if (!dirty) return;
    setStatus("dirty");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { void commit(); }, delay);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [value, delay, disabled, commit, eq]);

  // Auto-clear "saved" badge after a moment
  useEffect(() => {
    if (status !== "saved") return;
    const t = setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 2000);
    return () => clearTimeout(t);
  }, [status]);

  const saveNow = useCallback(async () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    await commit();
  }, [commit]);

  const resetBaseline = useCallback((next?: T) => {
    baselineRef.current = next ?? latestRef.current;
    setStatus("idle");
  }, []);

  const isDirty = !eq(value, baselineRef.current);

  return { status, lastSavedAt, isDirty, saveNow, resetBaseline };
}

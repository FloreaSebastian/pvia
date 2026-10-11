/** Scope-aware async result guard, shared by statistics reads and exports. */
export function createStatsScope() {
  let scope = "";
  let generation = 0;
  let disposed = false;
  return {
    set(next: string) {
      if (next !== scope) {
        scope = next;
        generation++;
      }
    },
    begin() {
      const captured = scope;
      const revision = ++generation;
      return () => !disposed && captured === scope && revision === generation;
    },
    capture() {
      const captured = scope;
      const revision = generation;
      return () => !disposed && captured === scope && revision === generation;
    },
    dispose() {
      disposed = true;
      generation++;
    },
  };
}

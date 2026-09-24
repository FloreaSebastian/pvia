/**
 * Solar Studio P2-A — édition manuelle du câblage (pure, immuable) + historique local.
 */
import type { ElecGroup } from "./types";

export function moveModules(
  groups: ElecGroup[],
  moduleIds: string[],
  targetGroupId: string | null,
): ElecGroup[] {
  const ids = new Set(moduleIds);
  return groups.map((g) => {
    const kept = g.module_ids.filter((id) => !ids.has(id));
    if (g.id === targetGroupId) return { ...g, module_ids: [...kept, ...moduleIds] };
    return kept.length === g.module_ids.length ? g : { ...g, module_ids: kept };
  });
}

export function addEmptyGroup(
  groups: ElecGroup[],
  kind: "string" | "micro",
  mpptIndex: number | null,
  inverterIndex = 0,
): ElecGroup[] {
  let n = groups.length + 1;
  const ids = new Set(groups.map((g) => g.id));
  while (ids.has(`${kind === "micro" ? "m" : "s"}${n}`)) n += 1;
  const id = `${kind === "micro" ? "m" : "s"}${n}`;
  return [
    ...groups,
    {
      id,
      kind,
      label: kind === "micro" ? `µ${n}` : `S${n}`,
      inverter_index: inverterIndex,
      mppt_index: kind === "micro" ? null : mpptIndex,
      module_ids: [],
    },
  ];
}

/** Supprime uniquement une string vide. */
export function removeEmptyGroup(groups: ElecGroup[], id: string): ElecGroup[] {
  const g = groups.find((x) => x.id === id);
  if (!g || g.module_ids.length > 0) return groups;
  return groups.filter((x) => x.id !== id);
}

export function setGroupMppt(
  groups: ElecGroup[],
  id: string,
  inverterIndex: number,
  mpptIndex: number,
): ElecGroup[] {
  return groups.map((g) =>
    g.id === id ? { ...g, inverter_index: inverterIndex, mppt_index: mpptIndex } : g,
  );
}

/** Rééquilibre les strings d'un même MPPT à longueurs aussi égales que possible (ordre conservé). */
export function rebalanceMppt(
  groups: ElecGroup[],
  inverterIndex: number,
  mpptIndex: number,
): ElecGroup[] {
  const targets = groups.filter(
    (g) => g.kind === "string" && g.inverter_index === inverterIndex && g.mppt_index === mpptIndex,
  );
  if (targets.length < 2) return groups;
  const all = targets.flatMap((g) => g.module_ids);
  const base = Math.floor(all.length / targets.length);
  let extra = all.length % targets.length;
  let cursor = 0;
  const next = new Map<string, string[]>();
  for (const g of targets) {
    const n = base + (extra > 0 ? 1 : 0);
    if (extra > 0) extra -= 1;
    next.set(g.id, all.slice(cursor, cursor + n));
    cursor += n;
  }
  return groups.map((g) => (next.has(g.id) ? { ...g, module_ids: next.get(g.id)! } : g));
}

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}
export const HISTORY_LIMIT = 50;
export function historyInit<T>(v: T): History<T> {
  return { past: [], present: v, future: [] };
}
export function historyPush<T>(h: History<T>, v: T): History<T> {
  return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: v, future: [] };
}
export function historyUndo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h;
  return {
    past: h.past.slice(0, -1),
    present: h.past[h.past.length - 1],
    future: [h.present, ...h.future],
  };
}
export function historyRedo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}

export const GROUP_COLORS = [
  "#2563eb",
  "#dc2626",
  "#16a34a",
  "#d97706",
  "#7c3aed",
  "#0891b2",
  "#db2777",
  "#65a30d",
  "#ea580c",
  "#4f46e5",
  "#0d9488",
  "#b91c1c",
];
export function groupColor(index: number): string {
  return GROUP_COLORS[index % GROUP_COLORS.length];
}

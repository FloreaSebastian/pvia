/**
 * Smart PV Layout Engine — réduction d'une grille au nombre de modules visé.
 *
 * On ne coupe jamais au hasard : on conserve les rangées pleines depuis
 * l'égout, puis on centre la rangée incomplète. Le résultat reste lisible
 * sur le toit et reproductible.
 */
import type { GridPlacement } from "./generate";

export function selectCount(placements: GridPlacement[], target: number): GridPlacement[] {
  if (target >= placements.length) return placements;
  if (target <= 0) return [];

  const byRow = new Map<number, GridPlacement[]>();
  for (const p of placements) {
    const list = byRow.get(p.row) ?? [];
    list.push(p);
    byRow.set(p.row, list);
  }
  const rows = [...byRow.keys()].sort((a, b) => a - b);

  const kept: GridPlacement[] = [];
  let remaining = target;
  for (const row of rows) {
    if (remaining <= 0) break;
    const list = [...byRow.get(row)!].sort((a, b) => a.col - b.col);
    if (list.length <= remaining) {
      kept.push(...list);
      remaining -= list.length;
      continue;
    }
    // Rangée partielle : on garde les modules centrés.
    const drop = list.length - remaining;
    const left = Math.floor(drop / 2);
    kept.push(...list.slice(left, left + remaining));
    remaining = 0;
  }
  return kept;
}

/** Nombre de modules correspondant à une puissance cible, selon l'arbitrage choisi. */
export function modulesForPower(
  power_kwc: number,
  power_wc: number,
  rounding: "closest" | "under" | "over",
): number {
  if (!(power_wc > 0)) return 0;
  const exact = (power_kwc * 1000) / power_wc;
  if (rounding === "under") return Math.max(0, Math.floor(exact + 1e-9));
  if (rounding === "over") return Math.max(0, Math.ceil(exact - 1e-9));
  return Math.max(0, Math.round(exact));
}

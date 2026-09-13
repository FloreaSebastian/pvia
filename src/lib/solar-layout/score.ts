/**
 * Smart PV Layout Engine — critères et explication.
 *
 * Aucun « score IA ». Chaque critère est mesurable, affichable et traduit en
 * phrase compréhensible par l'utilisateur.
 */
import { moduleSize } from "./generate";
import type { LayoutModule, LayoutModuleSpec, ScoreCriteria, Strategy } from "./types";

export function powerKwc(count: number, power_wc: number): number {
  return Math.round(((count * power_wc) / 1000) * 100) / 100;
}

export function computeCriteria(
  modules: LayoutModule[],
  spec: LayoutModuleSpec,
  usableArea_m2: number,
  targetPowerKwc: number | null,
  priorityCount = 0,
): ScoreCriteria {
  const count = modules.length;
  const power = powerKwc(count, spec.power_wc);

  let moduleArea = 0;
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const m of modules) {
    const s = moduleSize(spec, m.orientation);
    moduleArea += s.width * s.length;
    minU = Math.min(minU, m.u - s.width / 2);
    maxU = Math.max(maxU, m.u + s.width / 2);
    minV = Math.min(minV, m.v - s.length / 2);
    maxV = Math.max(maxV, m.v + s.length / 2);
  }
  const envelope = count > 0 ? Math.max(1e-6, (maxU - minU) * (maxV - minV)) : 1;

  const rowCounts = new Map<string, number>();
  for (const m of modules) {
    const k = `${m.plane_key}#${m.row}`;
    rowCounts.set(k, (rowCounts.get(k) ?? 0) + 1);
  }
  const maxRow = Math.max(0, ...rowCounts.values());
  let aligned = 0;
  for (const [, n] of rowCounts) if (n === maxRow) aligned += n;

  let isolated = 0;
  for (const a of modules) {
    const hasNeighbour = modules.some(
      (b) => b !== a && b.plane_key === a.plane_key && Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1,
    );
    if (!hasNeighbour) isolated += 1;
  }

  const matrices = new Set(modules.map((m) => `${m.plane_key}#${m.matrix}`)).size;

  return {
    module_count: count,
    power_kwc: power,
    target_gap_kwc: targetPowerKwc === null ? null : Math.round(Math.abs(power - targetPowerKwc) * 100) / 100,
    matrices,
    fill_ratio: usableArea_m2 > 0 ? Math.min(1, Math.round((moduleArea / usableArea_m2) * 1000) / 1000) : 0,
    alignment_ratio: count > 0 ? Math.round((aligned / count) * 1000) / 1000 : 0,
    compactness: count > 0 ? Math.min(1, Math.round((moduleArea / envelope) * 1000) / 1000) : 0,
    isolated_modules: isolated,
    in_priority_zone: priorityCount,
  };
}

const WEIGHTS: Record<Strategy, { count: number; gap: number; matrices: number; align: number; compact: number; isolated: number; priority: number }> = {
  maximum: { count: 10, gap: 0, matrices: 0.5, align: 1, compact: 2, isolated: 0.5, priority: 0.5 },
  esthetique: { count: 1, gap: 4, matrices: 6, align: 12, compact: 10, isolated: 4, priority: 3 },
  equilibre: { count: 4, gap: 8, matrices: 3, align: 6, compact: 5, isolated: 2, priority: 2 },
};

export function scoreCandidate(c: ScoreCriteria, strategy: Strategy): number {
  const w = WEIGHTS[strategy];
  let s = 0;
  s += w.count * c.module_count;
  if (c.target_gap_kwc !== null) s -= w.gap * c.target_gap_kwc * 10;
  s -= w.matrices * Math.max(0, c.matrices - 1);
  s += w.align * c.alignment_ratio;
  s += w.compact * c.compactness;
  s -= w.isolated * c.isolated_modules;
  s += w.priority * (c.module_count > 0 ? c.in_priority_zone / c.module_count : 0);
  return Math.round(s * 1000) / 1000;
}

export function explain(c: ScoreCriteria, targetPowerKwc: number | null, planeCount: number): string[] {
  const out: string[] = [];
  out.push(`${c.module_count} panneau${c.module_count > 1 ? "x" : ""} — ${c.power_kwc.toFixed(2)} kWc`);
  if (targetPowerKwc !== null) {
    out.push(
      c.target_gap_kwc === 0
        ? "Puissance cible atteinte exactement"
        : `Écart à la cible : ${c.target_gap_kwc?.toFixed(2)} kWc`,
    );
  }
  out.push(c.matrices <= 1 ? "Une seule matrice" : `${c.matrices} matrices`);
  if (planeCount > 1) out.push(`Réparti sur ${planeCount} pans`);
  out.push(
    c.alignment_ratio >= 0.999
      ? "Rangées toutes complètes"
      : `${Math.round(c.alignment_ratio * 100)} % des panneaux en rangée pleine`,
  );
  out.push(`Occupation de la zone exploitable : ${Math.round(c.fill_ratio * 100)} %`);
  if (c.isolated_modules > 0) out.push(`${c.isolated_modules} panneau(x) isolé(s)`);
  if (c.in_priority_zone > 0) out.push(`${c.in_priority_zone} panneau(x) en zone prioritaire`);
  return out;
}

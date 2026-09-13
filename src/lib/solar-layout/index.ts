/**
 * Smart PV Layout Engine — point d'entrée.
 *
 * Entrée : pans, module, profil de règles, objectif, stratégie.
 * Sortie : plusieurs implantations réellement différentes, expliquées.
 *
 * Déterministe : mêmes entrées + même version = même sortie.
 */
import { generateGrids, placementSignature, toModules, type GridResult } from "./generate";
import { modulesForPower, selectCount } from "./select";
import { computeCriteria, explain, powerKwc, scoreCandidate } from "./score";
import { buildUsableArea, type UsableArea } from "./usable-area";
import {
  LAYOUT_ENGINE_VERSION,
  type LayoutCandidate,
  type LayoutModule,
  type LayoutPlane,
  type LayoutRequest,
  type Orientation,
  type Strategy,
} from "./types";

export * from "./types";
export * from "./geometry";
export * from "./rules";
export * from "./usable-area";
export * from "./generate";
export * from "./select";
export * from "./score";
export * from "./validate";

const STRATEGY_LABEL: Record<Strategy, string> = {
  equilibre: "Équilibré",
  esthetique: "Esthétique",
  maximum: "Maximum toiture",
};

export interface LayoutResult {
  candidates: LayoutCandidate[];
  /** Nombre maximal de modules réellement posables, toutes contraintes respectées. */
  max_modules: number;
  max_power_kwc: number;
  /** Nombre de modules visé (0 en mode maximum). */
  target_modules: number;
  /** L'objectif demandé est-il atteignable ? */
  achievable: boolean;
  engine_version: string;
  /** Nombre de grilles réellement évaluées. */
  candidates_evaluated: number;
}

function orientationsFor(mode: LayoutRequest["orientation"]): Orientation[] {
  if (mode === "portrait") return ["portrait"];
  if (mode === "paysage") return ["paysage"];
  return ["portrait", "paysage"];
}

function orderPlanes(planes: LayoutPlane[], priority?: string[]): LayoutPlane[] {
  if (!priority?.length) return planes;
  const rank = new Map(priority.map((k, i) => [k, i]));
  return [...planes].sort((a, b) => (rank.get(a.key) ?? 999) - (rank.get(b.key) ?? 999));
}

interface PlaneWork {
  plane: LayoutPlane;
  area: UsableArea;
  grids: GridResult[];
  max: number;
}

export function generateLayouts(req: LayoutRequest): LayoutResult {
  const orientations = orientationsFor(req.orientation);
  const planes = orderPlanes(req.planes, req.plane_priority);
  const spec = req.module;

  const work: PlaneWork[] = planes.map((plane) => {
    const area = buildUsableArea(plane, req.rules);
    const grids = generateGrids(area, spec, req.rules, orientations);
    const max = grids.reduce((m, g) => Math.max(m, g.placements.length), 0);
    return { plane, area, grids, max };
  });

  const evaluated = work.reduce((n, w) => n + w.grids.length, 0);
  const maxModules = work.reduce((n, w) => n + w.max, 0);
  const usableArea = work.reduce((a, w) => a + w.area.area_m2, 0);

  const targetModules =
    req.target.mode === "power"
      ? modulesForPower(req.target.power_kwc ?? 0, spec.power_wc, req.target.rounding)
      : req.target.mode === "count"
        ? Math.max(0, Math.floor(req.target.count ?? 0))
        : 0;

  const isTargeted = req.target.mode !== "max";
  const achievable = !isTargeted || targetModules <= maxModules;
  const targetPower = isTargeted ? powerKwc(targetModules, spec.power_wc) : null;

  const strategies: Strategy[] = req.strategies?.length
    ? req.strategies
    : isTargeted
      ? ["equilibre", "esthetique", "maximum"]
      : ["maximum", "esthetique"];

  const bySignature = new Map<string, LayoutCandidate>();

  for (const strategy of strategies) {
    // En stratégie « maximum », l'objectif chiffré ne borne plus la pose.
    const wanted = strategy === "maximum" || !isTargeted ? Infinity : targetModules;
    const { modules, priorityCount, planesUsed } = assemble(work, wanted, strategy, spec, req, targetPower);
    if (modules.length === 0) continue;

    const criteria = computeCriteria(modules, spec, usableArea, targetPower, priorityCount);
    const signature = placementSignature(modules);
    const candidate: LayoutCandidate = {
      id: `${strategy}-${signature.length}-${modules.length}`,
      label: STRATEGY_LABEL[strategy],
      strategy,
      orientation: uniqueOrientation(modules),
      modules,
      power_kwc: criteria.power_kwc,
      criteria,
      score: scoreCandidate(criteria, strategy),
      reasons: explain(criteria, targetPower, planesUsed),
      signature,
      engine_version: LAYOUT_ENGINE_VERSION,
    };
    // Pas de variante artificielle : deux résultats identiques restent un seul.
    if (!bySignature.has(signature)) bySignature.set(signature, candidate);
  }

  const candidates = [...bySignature.values()]
    .sort((a, b) => b.score - a.score || a.signature.localeCompare(b.signature))
    .slice(0, req.max_variants ?? 3)
    .map((c, i) => ({ ...c, label: `Variante ${String.fromCharCode(65 + i)} — ${c.label}` }));

  return {
    candidates,
    max_modules: maxModules,
    max_power_kwc: powerKwc(maxModules, spec.power_wc),
    target_modules: targetModules,
    achievable,
    engine_version: LAYOUT_ENGINE_VERSION,
    candidates_evaluated: evaluated,
  };
}

function assemble(
  work: PlaneWork[],
  wanted: number,
  strategy: Strategy,
  spec: LayoutRequest["module"],
  req: LayoutRequest,
  targetPower: number | null,
): { modules: LayoutModule[]; priorityCount: number; planesUsed: number } {
  let remaining = wanted;
  const modules: LayoutModule[] = [];
  let priorityCount = 0;
  let planesUsed = 0;

  for (const w of work) {
    if (remaining <= 0) break;
    let bestKept: GridResult["placements"] | null = null;
    let bestScore = -Infinity;

    for (const grid of w.grids) {
      const take = Number.isFinite(remaining) ? Math.min(remaining, grid.placements.length) : grid.placements.length;
      const kept = selectCount(grid.placements, take);
      if (kept.length === 0) continue;
      const localModules = toModules(kept, strategy);
      const localCriteria = computeCriteria(
        localModules,
        spec,
        w.area.area_m2,
        null,
        kept.filter((p) => p.priority).length,
      );
      const s = scoreCandidate(localCriteria, strategy);
      if (s > bestScore + 1e-9) {
        bestScore = s;
        bestKept = kept;
      }
    }

    if (!bestKept) continue;
    modules.push(...toModules(bestKept, `${strategy}-${w.plane.key}`));
    priorityCount += bestKept.filter((p) => p.priority).length;
    planesUsed += 1;
    if (Number.isFinite(remaining)) remaining -= bestKept.length;
  }

  void req;
  void targetPower;
  return { modules, priorityCount, planesUsed };
}

function uniqueOrientation(modules: LayoutModule[]): Orientation | "mixte" {
  const set = new Set(modules.map((m) => m.orientation));
  if (set.size === 1) return [...set][0]!;
  return "mixte";
}
